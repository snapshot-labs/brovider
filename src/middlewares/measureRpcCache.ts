import { NextFunction, Request, Response } from 'express';
import { REQUEST_TIMEOUT } from '../constants';
import { rpcCacheKeyRepeatCount, rpcResponseSizeBytes } from '../helpers/metrics';
import { fetchWithKeepAlive, sha256 } from '../helpers/utils';

type Node = { url: string; network: string; headers: Record<string, string> };

const SHORT_WINDOW_SIZE = 500;
const LONG_WINDOW_SIZE = 20000;
const SAMPLE_RATE = 20;

const HEX_BLOCK = /^0x[0-9a-f]+$/i;

const ETH_BLOCK_PARAM_INDEX = new Map([
  ['eth_getBlockByNumber', 0],
  ['eth_getBlockReceipts', 0]
]);

const STARKNET_BLOCK_PARAM_INDEX = new Map([
  ['starknet_getBlockWithTxHashes', 0],
  ['starknet_getBlockWithTxs', 0],
  ['starknet_getBlockWithReceipts', 0],
  ['starknet_getStateUpdate', 0],
  ['starknet_getBlockTransactionCount', 0],
  ['starknet_getTransactionByBlockIdAndIndex', 0],
  ['starknet_call', 1],
  ['starknet_getStorageAt', 2],
  ['starknet_getClass', 0],
  ['starknet_getClassAt', 0],
  ['starknet_getClassHashAt', 0],
  ['starknet_getNonce', 0]
]);

const HASH_KEYED_METHODS = new Set(['eth_getTransactionReceipt', 'starknet_getTransactionReceipt']);

const MEASURED_METHODS = new Set<string>([
  'eth_getLogs',
  'starknet_getEvents',
  ...HASH_KEYED_METHODS,
  ...ETH_BLOCK_PARAM_INDEX.keys(),
  ...STARKNET_BLOCK_PARAM_INDEX.keys()
]);

function isEthBlockPinned(value: unknown): boolean {
  return typeof value === 'string' && HEX_BLOCK.test(value);
}

function isStarknetBlockPinned(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (typeof (value as any).block_number === 'number' ||
      typeof (value as any).block_hash === 'string')
  );
}

function isEthGetLogsPinned(params: unknown): boolean {
  const filter: any = Array.isArray(params) ? params[0] : undefined;
  if (!filter || typeof filter !== 'object') return false;
  if (isEthBlockPinned(filter.blockHash)) return true;
  return isEthBlockPinned(filter.fromBlock) && isEthBlockPinned(filter.toBlock);
}

function isStarknetGetEventsPinned(params: unknown): boolean {
  const filter: any = Array.isArray(params) ? params[0] : undefined;
  if (!filter || typeof filter !== 'object') return false;
  return isStarknetBlockPinned(filter.from_block) && isStarknetBlockPinned(filter.to_block);
}

function isPinned(method: string, params: unknown): boolean {
  if (HASH_KEYED_METHODS.has(method)) return true;
  if (method === 'eth_getLogs') return isEthGetLogsPinned(params);
  if (method === 'starknet_getEvents') return isStarknetGetEventsPinned(params);

  const ethIndex = ETH_BLOCK_PARAM_INDEX.get(method);
  if (ethIndex !== undefined) return Array.isArray(params) && isEthBlockPinned(params[ethIndex]);

  const starknetIndex = STARKNET_BLOCK_PARAM_INDEX.get(method);
  if (starknetIndex !== undefined) {
    return Array.isArray(params) && isStarknetBlockPinned(params[starknetIndex]);
  }

  return false;
}

class KeyWindow {
  private readonly maxSize: number;
  private readonly keys = new Set<string>();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  see(key: string): boolean {
    const seen = this.keys.delete(key);
    this.keys.add(key);
    if (this.keys.size > this.maxSize) {
      const oldest = this.keys.values().next().value;
      if (oldest !== undefined) this.keys.delete(oldest);
    }
    return seen;
  }

  clear() {
    this.keys.clear();
  }
}

const shortWindow = new KeyWindow(SHORT_WINDOW_SIZE);
const longWindow = new KeyWindow(LONG_WINDOW_SIZE);
const sampleCounts = new Map<string, number>();

function shouldSample(method: string): boolean {
  const count = (sampleCounts.get(method) ?? 0) + 1;
  sampleCounts.set(method, count);
  return count % SAMPLE_RATE === 0;
}

async function sampleResponseSize(
  node: Node,
  body: unknown,
  rpcMethod: string,
  pinnedLabel: string
) {
  const res = await fetchWithKeepAlive(node.url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...node.headers },
    timeout: REQUEST_TIMEOUT,
    body: JSON.stringify(body)
  });
  const text = await res.text();
  rpcResponseSizeBytes.observe({ rpc_method: rpcMethod, pinned: pinnedLabel }, text.length);
}

export default function measureRpcCache(req: Request, res: Response, next: NextFunction) {
  next();

  try {
    const node: Node | undefined = (req as any)._node;
    const body = req.body || {};
    const method = body.method;
    if (!node || typeof method !== 'string' || !MEASURED_METHODS.has(method)) return;

    const pinnedLabel = isPinned(method, body.params) ? 'pinned' : 'unpinned';
    const key = sha256(`${node.network}:${method}:${JSON.stringify(body.params)}`);

    rpcCacheKeyRepeatCount.inc({
      rpc_method: method,
      pinned: pinnedLabel,
      window: 'short',
      status: shortWindow.see(key) ? 'HIT' : 'MISS'
    });
    rpcCacheKeyRepeatCount.inc({
      rpc_method: method,
      pinned: pinnedLabel,
      window: 'long',
      status: longWindow.see(key) ? 'HIT' : 'MISS'
    });

    if (shouldSample(method)) {
      sampleResponseSize(node, body, method, pinnedLabel).catch(e => {
        console.log('[measureRpcCache] size sample failed', method, e?.message ?? e);
      });
    }
  } catch (e: any) {
    console.log('[measureRpcCache] measurement error', e?.message ?? e);
  }
}

export function reset() {
  shortWindow.clear();
  longWindow.clear();
  sampleCounts.clear();
}
