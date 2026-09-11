import { REQUEST_TIMEOUT } from '../constants';
import { rpcCacheHeadLookupCount } from './metrics';
import { Node } from './nodes';
import serve from './requestDeduplicator';
import { fetchWithKeepAlive } from './utils';

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

const heads = new Map<
  string,
  { url: string; number: number | null; checkedAt: number }
>();

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

export async function headOf(
  node: Node,
  family: Family,
  needed: number
): Promise<number | null> {
  const known = heads.get(node.network);
  // A remembered head is only a valid lower bound for the node that reported
  // it: if the network now points at a different URL (DB failover, including
  // onto a different chain entirely), discard it and look the head up again
  // rather than certify blocks against a provider we never asked.
  const stale = known !== undefined && known.url !== node.url;
  if (!stale && known) {
    if (known.number !== null && known.number >= needed) return known.number;
    if (known.checkedAt + HEAD_TTL > Date.now()) return known.number;
  }

  let number = stale ? null : (known?.number ?? null);
  try {
    const result = await serve(
      `${node.network}:${family.headMethod}`,
      blockNumber,
      [node, family]
    );
    const parsed = family.parseBlock(result);
    if (parsed === undefined) {
      // The lookup answered (no fetch error, so no metric-worthy attempt is
      // missed), but not with a usable quantity: a JSON-RPC error body, or a
      // result the family can't parse. Log it, since nothing else will.
      console.log('[chainHead] head lookup returned no usable result', {
        network: node.network,
        result
      });
    } else {
      number = parsed;
    }
  } catch (err) {
    const { errors } = (err ?? {}) as { errors?: { message?: string }[] };
    console.log(
      '[chainHead] head lookup failed',
      node.network,
      errors?.[0]?.message ?? err
    );
  }

  heads.set(node.network, { url: node.url, number, checkedAt: Date.now() });
  return number;
}
