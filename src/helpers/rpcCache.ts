import { client } from '@snapshot-labs/snapshot-metrics';
import { rpcCacheEvictions } from './metrics';
import { REQUEST_TIMEOUT } from '../constants';
import { sha256 } from './utils';

// In-memory LRU of RPC answers that can never change, so repeated reads
// (blue and green indexers fetching the same blocks) skip the paid node.

// Invalid values fall back to the safe default instead of NaN
function integer(value: string | undefined, fallback: number, min: number) {
  const number = Number(value);
  return value && Number.isSafeInteger(number) && number >= min
    ? number
    : fallback;
}

export function readConfig(env: Record<string, string | undefined>) {
  return {
    mode: (env.RPC_CACHE === 'shadow' || env.RPC_CACHE === 'on'
      ? env.RPC_CACHE
      : 'off') as 'off' | 'shadow' | 'on',
    maxBytes: integer(env.RPC_CACHE_MB, 512, 1) * 1024 * 1024,
    maxEntryBytes: 2 * 1024 * 1024,
    timeout: REQUEST_TIMEOUT,
    // Blocks behind the highest seen block before a block number is trusted
    depth: integer(env.RPC_CACHE_DEPTH, 32, 0)
  };
}

export const config = readConfig(process.env);

const DEPTH_BY_NETWORK: Record<string, number> = {
  '137': 256 // Polygon PoS has had deep reorgs
};

const QUANTITY = /^0x[0-9a-f]+$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const ENTRY_OVERHEAD = 64 + 64; // key string + Map slot, roughly

export type Pinned = {
  key: string;
  // Block number the answer depends on; undefined when pinned by hash
  block?: number;
};

const entries = new Map<string, Buffer>();
const heads = new Map<string, number>();
let bytes = 0;

function quantity(value: unknown): number | undefined {
  if (typeof value !== 'string' || !QUANTITY.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

function isHash(value: unknown): boolean {
  return typeof value === 'string' && HASH.test(value);
}

// A block number, or an EIP-1898 { blockHash } object. With requireCanonical
// the answer turns into an error once the block is reorged out, so skip it.
function blockOf(value: any): { block?: number } | null {
  if (value && typeof value === 'object') {
    return isHash(value.blockHash) && value.requireCanonical !== true
      ? {}
      : null;
  }
  const block = quantity(value);
  return block === undefined ? null : { block };
}

function anchor(method: string, params: any[]): { block?: number } | null {
  const [first] = params;

  switch (method) {
    case 'eth_getBlockByNumber':
    case 'eth_getBlockReceipts': {
      const block = quantity(first);
      return block === undefined ? null : { block };
    }
    case 'eth_getBlockByHash':
      return isHash(first) ? {} : null;
    case 'eth_getLogs': {
      if (!first || typeof first !== 'object') return null;
      if (isHash(first.blockHash)) return {};
      const from = quantity(first.fromBlock);
      const to = quantity(first.toBlock);
      return from === undefined || to === undefined ? null : { block: to };
    }
    case 'eth_call':
    case 'eth_getBalance':
    case 'eth_getCode':
    case 'eth_getTransactionCount':
      return blockOf(params[1]);
    case 'eth_getStorageAt':
      return blockOf(params[2]);
    default:
      return null;
  }
}

/** The cache key of a read whose answer only depends on its params, or null. */
export function pin(
  network: string,
  method: string,
  params: unknown
): Pinned | null {
  if (!Array.isArray(params)) return null;
  const found = anchor(method, params);
  if (!found) return null;

  return {
    key: sha256(`${network}:${method}:${JSON.stringify(params)}`),
    block: found.block
  };
}

function cost(key: string, value: Buffer): number {
  return value.length + key.length + ENTRY_OVERHEAD;
}

/** Returns the stored answer and marks it as the most recently used. */
export function get(key: string): Buffer | undefined {
  const value = entries.get(key);
  if (value) {
    entries.delete(key);
    entries.set(key, value);
  }
  return value;
}

export function set(key: string, value: Buffer) {
  const previous = entries.get(key);
  if (previous) {
    bytes -= cost(key, previous);
    entries.delete(key);
  }
  entries.set(key, value);
  bytes += cost(key, value);

  // Map iterates in insertion order, so the first entry is the least recent
  while (bytes > config.maxBytes && entries.size > 0) {
    const [oldestKey, oldest] = entries.entries().next().value!;
    entries.delete(oldestKey);
    bytes -= cost(oldestKey, oldest);
    rpcCacheEvictions.inc();
  }
}

export function updateHead(network: string, block: number) {
  if (block > (heads.get(network) ?? -1)) heads.set(network, block);
}

/** Why a block-number answer cannot be stored yet, or null when it can. */
export function tooRecent(network: string, block: number): string | null {
  const head = heads.get(network);
  if (head === undefined) return 'head_unknown';
  const depth = Math.max(DEPTH_BY_NETWORK[network] ?? 0, config.depth);
  return block > head - depth ? 'too_recent' : null;
}

// Read only when /metrics is scraped, so requests pay nothing for them
new client.Gauge({
  name: 'rpc_cache_bytes',
  help: 'Approximate memory used by cached RPC answers',
  collect() {
    this.set(bytes);
  }
});

new client.Gauge({
  name: 'rpc_cache_entries',
  help: 'Number of cached RPC answers',
  collect() {
    this.set(entries.size);
  }
});

export function stats() {
  return { bytes, entries: entries.size };
}

export function resetCache() {
  entries.clear();
  heads.clear();
  bytes = 0;
}
