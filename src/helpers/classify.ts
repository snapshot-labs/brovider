/** Distance from head, in either direction, that still counts as live. */
const LIVE_BLOCKS = 1000;

const LIVE_TAGS = new Set(['latest', 'pending', 'safe', 'finalized']);

function isLiveBlock(value: unknown, head: number): boolean {
  if (typeof value !== 'string') return false;
  if (LIVE_TAGS.has(value)) return true;

  const blockNumber = parseInt(value, 16);
  return (
    Number.isFinite(blockNumber) && Math.abs(head - blockNumber) <= LIVE_BLOCKS
  );
}

/**
 * Whether a request only touches the chain head and can be served by a public node.
 * Everything that reads state or old data stays on the main node.
 */
export function isLiveRequest(
  body: Record<string, any>,
  head: number
): boolean {
  const { method, params } = body;
  const first = Array.isArray(params) ? params[0] : undefined;

  switch (method) {
    case 'eth_blockNumber':
      return true;
    case 'eth_getBlockByNumber':
      return isLiveBlock(first, head);
    case 'eth_getLogs':
      if (!first || typeof first !== 'object') return false;
      if (typeof first.blockHash === 'string') return true;
      return (
        isLiveBlock(first.fromBlock, head) &&
        isLiveBlock(first.toBlock ?? 'latest', head)
      );
    default:
      return false;
  }
}
