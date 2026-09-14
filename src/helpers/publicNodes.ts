import { capture } from '@snapshot-labs/snapshot-sentry';
import { publicNodeReadyCount } from './metrics';
import { publicNodes as configuredNodes } from './nodes';
import { fetchWithKeepAlive, sleep } from './utils';

const CHECK_INTERVAL = 15e3;
const CHECK_TIMEOUT = 5e3;
/** Consecutive passed checks before a node serves traffic. */
const MIN_OK_STREAK = 3;
/** Latest block older than this means the node is lagging. */
const MAX_BLOCK_AGE = 30;
/** Nodes this close to the best head are rotated evenly. */
const FRESH_TOLERANCE = 2;

type PublicNode = {
  url: string;
  head: number;
  okStreak: number;
};

const nodesByNetwork: Record<string, PublicNode[]> = {};
const counters: Record<string, number> = {};
let shouldStop = false;

async function rpc(url: string, method: string, params: unknown[] = []) {
  const res = await fetchWithKeepAlive(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeout: CHECK_TIMEOUT,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!res.ok) throw new Error(`status ${res.status}`);

  const json = await res.json();
  if (json.error) throw new Error(json.error.message);

  return json.result;
}

async function check(network: string, node: PublicNode) {
  try {
    const chainId = await rpc(node.url, 'eth_chainId');
    if (parseInt(chainId, 16) !== Number(network)) throw new Error(`chain id ${chainId}`);

    const block = await rpc(node.url, 'eth_getBlockByNumber', ['latest', false]);
    const age = Date.now() / 1000 - parseInt(block?.timestamp, 16);
    if (!(age <= MAX_BLOCK_AGE)) throw new Error(`block age ${Math.round(age)}s`);

    node.head = parseInt(block.number, 16);
    node.okStreak += 1;
  } catch (err) {
    if (node.okStreak >= MIN_OK_STREAK) {
      console.log(`[public] ${network} ${node.url} removed: ${(err as Error).message}`);
    }
    node.okStreak = 0;
  }
}

function syncNodes() {
  for (const [network, urls] of Object.entries(configuredNodes)) {
    if (!/^\d+$/.test(network)) continue;

    const current = nodesByNetwork[network] ?? [];
    nodesByNetwork[network] = urls.map(
      url => current.find(node => node.url === url) ?? { url, head: 0, okStreak: 0 }
    );
  }

  for (const network of Object.keys(nodesByNetwork)) {
    if (!configuredNodes[network]) delete nodesByNetwork[network];
  }
}

export async function checkPublicNodes() {
  syncNodes();
  await Promise.all(
    Object.entries(nodesByNetwork).flatMap(([network, nodes]) =>
      nodes.map(node => check(network, node))
    )
  );
  for (const network of Object.keys(nodesByNetwork)) {
    publicNodeReadyCount.set({ network }, getReadyNodes(network).length);
  }
}

function getReadyNodes(network: string): PublicNode[] {
  return (nodesByNetwork[network] ?? [])
    .filter(node => node.okStreak >= MIN_OK_STREAK)
    .sort((a, b) => b.head - a.head);
}

export function getHead(network: string): number | null {
  return getReadyNodes(network)[0]?.head ?? null;
}

export function markFailed(network: string, url: string) {
  const node = nodesByNetwork[network]?.find(node => node.url === url);
  if (node) node.okStreak = 0;
}

export function selectNodes(network: string): string[] {
  const ready = getReadyNodes(network);
  if (ready.length === 0) return [];

  const best = ready[0].head;
  const fresh = ready.filter(node => node.head >= best - FRESH_TOLERANCE);
  const rest = ready.slice(fresh.length);

  const offset = (counters[network] = ((counters[network] ?? 0) + 1) % fresh.length);
  const rotated = [...fresh.slice(offset), ...fresh.slice(0, offset)];

  return [...rotated, ...rest].map(node => node.url);
}

export async function run() {
  console.log('[public] Starting public node health checks');
  while (!shouldStop) {
    try {
      await checkPublicNodes();
    } catch (err) {
      console.error('[public] Error checking nodes:', err);
      capture(err);
    }
    await sleep(CHECK_INTERVAL);
  }
}

export function stop() {
  shouldStop = true;
}
