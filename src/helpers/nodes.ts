import { capture } from '@snapshot-labs/snapshot-sentry';
import db from './db';
import { nodesRefreshCount } from './metrics';
import { sleep } from './utils';

export let nodes: Record<string, string> = {};
export let publicNodes: Record<string, string[]> = {};

const REFRESH_INTERVAL = 10e3; // 10 seconds
let shouldStop = false;

async function getNodes() {
  const providers = await db.query('SELECT * FROM providers');
  const rows = await db.query(
    'SELECT * FROM nodes ORDER BY network, main DESC'
  );

  const nodes: Record<string, string> = {};
  const publicNodes: Record<string, string[]> = {};
  for (const row of rows) {
    const url = providers.reduce(
      (url, key) => url.replace(`\${${key.name.toUpperCase()}}`, key.api_key),
      row.url
    );

    if (row.public) {
      (publicNodes[row.network] ??= []).push(url);
    } else if (!nodes[row.network]) {
      nodes[row.network] = url;
    }
  }

  return { nodes, publicNodes };
}

export async function run() {
  console.log('[nodes] Starting nodes refresh');
  while (!shouldStop) {
    try {
      nodesRefreshCount.inc();
      ({ nodes, publicNodes } = await getNodes());
    } catch (err) {
      console.error('[nodes] Error refreshing nodes:', err);
      capture(err);
    }
    await sleep(REFRESH_INTERVAL);
  }
}

export function stop() {
  console.log('[nodes] Stopping nodes refresh');
  shouldStop = true;
}
