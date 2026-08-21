import { NextFunction, Request, Response } from 'express';
import { REQUEST_TIMEOUT } from '../constants';
import { rpcCacheCount } from '../helpers/metrics';
import serve from '../helpers/requestDeduplicator';
import { fetchWithKeepAlive, sha256 } from '../helpers/utils';

type Node = { url: string; network: string; headers: Record<string, string> };

const BLOCK_PARAM_INDEX = new Map([
  ['eth_call', 1],
  ['eth_getBalance', 1],
  ['eth_getCode', 1],
  ['eth_getStorageAt', 2]
]);

const HEX_BLOCK = /^0x[0-9a-f]+$/i;
const CONFIRMATIONS = 128;
const HEAD_TTL = 10e3;
const MAX_VALUE_SIZE = 100e3;
const MAX_CACHE_SIZE = 64e6;

const cache = new Map<string, { value: any; size: number }>();
let cacheSize = 0;
const heads = new Map<string, { number: number | null; expiresAt: number }>();

function pinnedBlock(body: any): number | undefined {
  const index = BLOCK_PARAM_INDEX.get(body?.method);
  if (index === undefined || !Array.isArray(body.params)) return undefined;

  const param = body.params[index];
  if (typeof param !== 'string' || !HEX_BLOCK.test(param)) return undefined;

  return parseInt(param, 16);
}

async function rpcCall(node: Node, body: any) {
  const res = await fetchWithKeepAlive(node.url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...node.headers },
    timeout: REQUEST_TIMEOUT,
    body: JSON.stringify(body)
  });

  return { status: res.status, body: await res.json() };
}

async function headOf(node: Node): Promise<number | null> {
  const known = heads.get(node.network);
  if (known && known.expiresAt > Date.now()) return known.number;

  let number: number | null = null;
  try {
    const { body } = await serve(`${node.network}:eth_blockNumber`, rpcCall, [
      node,
      { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }
    ]);
    if (typeof body?.result === 'string' && HEX_BLOCK.test(body.result)) {
      number = parseInt(body.result, 16);
    }
  } catch (e: any) {
    console.log('[withRpcCache] head lookup failed', node.network, e.message || e);
  }

  heads.set(node.network, { number, expiresAt: Date.now() + HEAD_TTL });
  return number;
}

function readCache(key: string) {
  const entry = cache.get(key);
  if (entry === undefined) return undefined;

  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function writeCache(key: string, value: any) {
  const size = JSON.stringify(value).length;
  if (size > MAX_VALUE_SIZE) return;

  cacheSize += size - (cache.get(key)?.size ?? 0);
  cache.set(key, { value, size });

  while (cacheSize > MAX_CACHE_SIZE && cache.size > 1) {
    const [oldest, entry] = cache.entries().next().value as [string, { size: number }];
    cache.delete(oldest);
    cacheSize -= entry.size;
  }
}

export default async function withRpcCache(req: Request, res: Response, next: NextFunction) {
  const node: Node = (req as any)._node;
  const body = req.body;
  const block = pinnedBlock(body);

  if (block === undefined) {
    rpcCacheCount.inc({ status: 'BYPASS' });
    return next();
  }

  const key = sha256(`${node.network}:${body.method}:${JSON.stringify(body.params)}`);
  const cached = readCache(key);
  if (cached !== undefined) {
    rpcCacheCount.inc({ status: 'HIT' });
    return res.json({ jsonrpc: body.jsonrpc, id: body.id, result: cached });
  }

  rpcCacheCount.inc({ status: 'MISS' });
  const [head, response] = await Promise.all([
    headOf(node),
    serve(key, rpcCall, [node, body]).catch(() => null)
  ]);
  if (!response) return next();

  const payload = response.body;
  const isEnvelope = !!payload && typeof payload === 'object' && !Array.isArray(payload);
  const isFinal = head !== null && block <= head - CONFIRMATIONS;

  if (isEnvelope && isFinal && payload.error == null && payload.result != null) {
    writeCache(key, payload.result);
  }

  return res.status(response.status).json(isEnvelope ? { ...payload, id: body.id } : payload);
}
