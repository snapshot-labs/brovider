import { REQUEST_TIMEOUT } from '../constants';
import { rpcCacheHeadLookupCount } from './metrics';
import serve from './requestDeduplicator';
import { fetchWithKeepAlive } from './utils';

export type Node = {
  url: string;
  path: string;
  network: string;
  headers: Record<string, string>;
};

// What differs between chain families for the cache: how a block argument is
// read as a block number, and which method reports the head. One entry per
// JSON-RPC method prefix; a method whose prefix is absent here is never cached.
export type Family = {
  headMethod: string;
  parseBlock: (value: unknown) => number | undefined;
};

const HEX_QUANTITY = /^0x[0-9a-f]+$/i;

const FAMILIES: Record<string, Family> = {
  eth: {
    headMethod: 'eth_blockNumber',
    parseBlock: value =>
      typeof value === 'string' && HEX_QUANTITY.test(value)
        ? parseInt(value, 16)
        : undefined
  }
};

export function familyOf(method: string): Family | undefined {
  return FAMILIES[method.split('_', 1)[0]];
}

const HEAD_TTL = 10e3;

const heads = new Map<string, { number: number | null; checkedAt: number }>();

function reasonOf(err: unknown): string {
  const { code, name } = (err ?? {}) as { code?: unknown; name?: unknown };
  if (typeof code === 'string') return code;
  return typeof name === 'string' ? name : 'error';
}

async function blockNumber(node: Node, family: Family): Promise<unknown> {
  rpcCacheHeadLookupCount.inc({ network: node.network });

  let text: string;
  try {
    const res = await fetchWithKeepAlive(node.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...node.headers },
      timeout: REQUEST_TIMEOUT,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: family.headMethod,
        params: []
      })
    });
    text = await res.text();
  } catch (err) {
    // node-fetch puts the full url, api key included, in its error message
    throw new Error(`${node.network} head lookup failed: ${reasonOf(err)}`);
  }

  try {
    return JSON.parse(text)?.result;
  } catch {
    return undefined;
  }
}

// Head of the node's network as of the last lookup, or null if none succeeded yet.
// A remembered head only ever understates the chain, so it is reused as long as it
// already reaches `needed`; otherwise it is refreshed at most once per HEAD_TTL.
export async function headOf(
  node: Node,
  family: Family,
  needed: number
): Promise<number | null> {
  const known = heads.get(node.network);
  if (known && known.number !== null && known.number >= needed)
    return known.number;
  if (known && known.checkedAt + HEAD_TTL > Date.now()) return known.number;

  let number = known?.number ?? null;
  try {
    const result = await serve(
      `${node.network}:${family.headMethod}`,
      blockNumber,
      [node, family]
    );
    number = family.parseBlock(result) ?? number;
  } catch (err) {
    const { errors } = (err ?? {}) as { errors?: { message?: string }[] };
    console.log(
      '[chainHead] head lookup failed',
      node.network,
      errors?.[0]?.message ?? err
    );
  }

  heads.set(node.network, { number, checkedAt: Date.now() });
  return number;
}
