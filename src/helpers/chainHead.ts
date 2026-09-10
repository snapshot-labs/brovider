import { REQUEST_TIMEOUT } from '../constants';
import serve from './requestDeduplicator';
import { fetchWithKeepAlive } from './utils';

export type Node = {
  url: string;
  path: string;
  network: string;
  headers: Record<string, string>;
};

export const HEX_BLOCK = /^0x[0-9a-f]+$/i;
const HEAD_TTL = 10e3;

const heads = new Map<string, { number: number | null; expiresAt: number }>();

function reasonOf(err: unknown): string {
  const { code, name } = (err ?? {}) as { code?: unknown; name?: unknown };
  if (typeof code === 'string') return code;
  return typeof name === 'string' ? name : 'error';
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

// Latest block number of the node's network, looked up at most once per HEAD_TTL.
// null when the lookup failed, and that failure is remembered for the same window.
export async function headOf(node: Node): Promise<number | null> {
  const known = heads.get(node.network);
  if (known && known.expiresAt > Date.now()) return known.number;

  let number: number | null = null;
  try {
    const result = await serve(`${node.network}:eth_blockNumber`, blockNumber, [
      node
    ]);
    if (typeof result === 'string' && HEX_BLOCK.test(result))
      number = parseInt(result, 16);
  } catch (err) {
    const { errors } = (err ?? {}) as { errors?: { message?: string }[] };
    console.log(
      '[chainHead] head lookup failed',
      node.network,
      errors?.[0]?.message ?? err
    );
  }

  heads.set(node.network, { number, expiresAt: Date.now() + HEAD_TTL });
  return number;
}
