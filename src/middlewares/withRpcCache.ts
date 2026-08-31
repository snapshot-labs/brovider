import { NextFunction, Request, Response } from 'express';
import { REQUEST_TIMEOUT, RPC_CLIENTS, RPC_METHODS } from '../constants';
import { rpcCacheCount, rpcRequestCount } from '../helpers/metrics';
import serve from '../helpers/requestDeduplicator';
import { fetchWithKeepAlive, sha256 } from '../helpers/utils';

type Node = { url: string; network: string; headers: Record<string, string> };
type Entry = { value: string; size: number; expiresAt: number };

const BLOCK_PARAM_INDEX = new Map([
  ['eth_call', 1],
  ['eth_getBalance', 1],
  ['eth_getCode', 1],
  ['eth_getStorageAt', 2]
]);

const SKIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'etag',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

const SKIPPED_REQUEST_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'host'
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

function forwardedRequestHeaders(req: Request) {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!SKIPPED_REQUEST_HEADERS.has(name) && typeof value === 'string') headers[name] = value;
  }
  return headers;
}

async function rpcCall(node: Node, body: any, requestHeaders: Record<string, string> = {}) {
  let status: number;
  let headers: Record<string, string[]>;
  let text: string;

  try {
    const res = await fetchWithKeepAlive(node.url, {
      method: 'POST',
      headers: {
        ...requestHeaders,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...node.headers
      },
      timeout: REQUEST_TIMEOUT,
      body: JSON.stringify(body)
    });
    status = res.status;
    headers = res.headers.raw();
    text = await res.text();
  } catch (e: any) {
    throw new Error(`${node.network} upstream request failed: ${e?.code || e?.name || 'error'}`);
  }

  try {
    return { status, headers, text, body: JSON.parse(text) };
  } catch (e) {
    return { status, headers, text, body: undefined };
  }
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
    console.log('[withRpcCache] head lookup failed', node.network, e?.errors?.[0]?.message ?? e);
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

function writeCache(key: string, value: unknown) {
  if (typeof value !== 'string' || cache.has(key) || value.length > MAX_VALUE_SIZE) return;

  const size = 2 * (value.length + key.length) + ENTRY_OVERHEAD;
  cache.set(key, { value, size, expiresAt: Date.now() + ENTRY_TTL });
  cacheSize += size;

  while (cacheSize > MAX_CACHE_SIZE && cache.size > 1) {
    const [oldest, entry] = cache.entries().next().value as [string, Entry];
    cache.delete(oldest);
    cacheSize -= entry.size;
  }
}

export default async function withRpcCache(req: Request, res: Response, next: NextFunction) {
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

  const key = sha256(`${node.url}:${body.method}:${JSON.stringify(body.params)}`);
  const cached = readCache(key);
  if (cached !== undefined) {
    rpcCacheCount.inc({ status: 'HIT' });
    return res.json({ jsonrpc: '2.0', id: body.id, result: cached });
  }

  rpcCacheCount.inc({ status: 'MISS' });
  countRequest();
  const pendingHead = headOf(node);

  let response: Awaited<ReturnType<typeof rpcCall>>;
  try {
    response = await serve(key, rpcCall, [node, body, forwardedRequestHeaders(req)]);
  } catch {
    await pendingHead;
    return res.status(502).json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32603, message: 'Upstream request failed' }
    });
  }

  for (const [name, values] of Object.entries(response.headers)) {
    if (!SKIPPED_RESPONSE_HEADERS.has(name)) res.setHeader(name, values);
  }

  const payload = response.body;
  const isEnvelope = !!payload && typeof payload === 'object' && !Array.isArray(payload);
  if (isEnvelope) {
    res.status(response.status).json({ ...payload, id: body.id });
  } else {
    res.status(response.status).send(response.text);
  }

  const head = await pendingHead;
  if (isEnvelope && head !== null && block <= head - CONFIRMATIONS) {
    if (payload.error == null && payload.result != null) writeCache(key, payload.result);
  }
}
