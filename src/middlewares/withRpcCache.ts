import { NextFunction, Request, Response } from 'express';
import { REQUEST_TIMEOUT, RPC_CLIENTS, RPC_METHODS } from '../constants';
import { rpcCacheCount, rpcRequestCount } from '../helpers/metrics';
import serve from '../helpers/requestDeduplicator';
import { fetchWithKeepAlive, sha256 } from '../helpers/utils';

type Node = { url: string; network: string; headers: Record<string, string> };
type Entry = { value: string; size: number; expiresAt: number };
type Pending = {
  key: string;
  block: number;
  settle: (result?: string) => void;
};

const BLOCK_PARAM_INDEX = new Map([
  ['eth_call', 1],
  ['eth_getBalance', 1],
  ['eth_getCode', 1],
  ['eth_getStorageAt', 2]
]);

const HEX_BLOCK = /^0x[0-9a-f]+$/i;
const CONFIRMATIONS = 128;
const HEAD_TTL = 10e3;
const ENTRY_TTL = 3600e3;
const MAX_VALUE_SIZE = 100e3;
const MAX_CACHE_SIZE = 16e6;
const ENTRY_OVERHEAD = 128;

const cache = new Map<string, Entry>();
let cacheSize = 0;
const heads = new Map<string, { number: number | null; expiresAt: number }>();

function metricLabel(value: unknown, allowed: Set<string>) {
  if (value === undefined) return 'none';
  return typeof value === 'string' && allowed.has(value) ? value : 'other';
}

function pinnedBlock(body: any): number | undefined {
  const index = BLOCK_PARAM_INDEX.get(body?.method);
  if (index === undefined || !Array.isArray(body.params)) return undefined;

  const param = body.params[index];
  if (typeof param !== 'string' || !HEX_BLOCK.test(param)) return undefined;

  return parseInt(param, 16);
}

async function blockNumber(node: Node): Promise<unknown> {
  let text: string;
  try {
    const res = await fetchWithKeepAlive(node.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...node.headers },
      timeout: REQUEST_TIMEOUT,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: []
      })
    });
    text = await res.text();
  } catch (err: any) {
    // node-fetch puts the full url, api key included, in its error message
    throw new Error(
      `${node.network} head lookup failed: ${err?.code || err?.name || 'error'}`
    );
  }

  try {
    return JSON.parse(text)?.result;
  } catch {
    return undefined;
  }
}

async function headOf(node: Node): Promise<number | null> {
  const known = heads.get(node.network);
  if (known && known.expiresAt > Date.now()) return known.number;

  let number: number | null = null;
  try {
    const result = await serve(`${node.network}:eth_blockNumber`, blockNumber, [
      node
    ]);
    if (typeof result === 'string' && HEX_BLOCK.test(result))
      number = parseInt(result, 16);
  } catch (err: any) {
    console.log(
      '[withRpcCache] head lookup failed',
      node.network,
      err?.errors?.[0]?.message ?? err
    );
  }

  heads.set(node.network, { number, expiresAt: Date.now() + HEAD_TTL });
  return number;
}

function readCache(key: string) {
  const entry = cache.get(key);
  if (entry === undefined) return undefined;

  cache.delete(key);
  if (entry.expiresAt <= Date.now()) {
    cacheSize -= entry.size;
    return undefined;
  }

  cache.set(key, entry);
  return entry.value;
}

function writeCache(key: string, value: string) {
  if (cache.has(key) || value.length > MAX_VALUE_SIZE) return;

  const size = 2 * (value.length + key.length) + ENTRY_OVERHEAD;
  cache.set(key, { value, size, expiresAt: Date.now() + ENTRY_TTL });
  cacheSize += size;

  while (cacheSize > MAX_CACHE_SIZE && cache.size > 1) {
    const [oldest, entry] = cache.entries().next().value as [string, Entry];
    cache.delete(oldest);
    cacheSize -= entry.size;
  }
}

export default function withRpcCache(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const node: Node = (req as any)._node;
  const body = req.body;
  const block = pinnedBlock(body);
  const isNotification = !Object.hasOwn(body, 'id');

  const countRequest = () =>
    rpcRequestCount.inc({
      network: node.network,
      client: metricLabel(req.query.client, RPC_CLIENTS),
      rpc_method: metricLabel(body.method, RPC_METHODS)
    });

  if (block === undefined || isNotification) {
    rpcCacheCount.inc({ status: 'BYPASS' });
    countRequest();
    return next();
  }

  const key = sha256(
    `${node.url}:${body.method}:${JSON.stringify(body.params)}`
  );
  const reply = (result: string) =>
    res.json({ jsonrpc: '2.0', id: body.id, result });

  const cached = readCache(key);
  if (cached !== undefined) {
    rpcCacheCount.inc({ status: 'HIT' });
    return reply(cached);
  }
  rpcCacheCount.inc({ status: 'MISS' });
  countRequest();

  // Identical in-flight reads share one upstream call: the first one (the leader) goes through
  // the proxy and settles this promise from storeRpcResponse, the others answer from it.
  let settle: Pending['settle'] | undefined;
  const shared: Promise<string | undefined> = serve(
    key,
    () => new Promise(resolve => (settle = resolve)),
    []
  );
  if (!settle) {
    return shared
      .then(result =>
        result !== undefined ? reply(result) : withRpcCache(req, res, next)
      )
      .catch(next);
  }

  // Leader failed or went away before the decorator ran: release the followers to retry.
  res.on('close', () => settle!());
  (req as any)._cache = { key, block, settle };
  next();
}

export async function storeRpcResponse(
  proxyRes: unknown,
  data: Buffer,
  req: Request
) {
  const { key, block, settle }: Pending = (req as any)._cache;

  let payload: any;
  try {
    payload = JSON.parse(data.toString());
  } catch {
    return data;
  }

  if (payload?.error == null && typeof payload?.result === 'string') {
    settle(payload.result);
    const head = await headOf((req as any)._node);
    if (head !== null && block <= head - CONFIRMATIONS)
      writeCache(key, payload.result);
  }

  return data;
}
