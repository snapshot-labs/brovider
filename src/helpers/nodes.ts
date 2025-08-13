import { capture } from '@snapshot-labs/snapshot-sentry';
import db from './db';
import { nodesRefreshCount } from './metrics';
import { sleep } from './utils';

export let nodes = {};

const REFRESH_INTERVAL = 10e3; // 10 seconds
let shouldStop = false;

async function getNodes() {
  const providers = await db.query('SELECT * FROM providers');
  const nodes = await db.query('SELECT * FROM nodes WHERE main = 1');

  return nodes.reduce((result, node) => {
    result[node.network] = providers.reduce(
      (url, key) => url.replace(`\${${key.name.toUpperCase()}}`, key.api_key),
      node.url
    );
    return result;
  }, {});
}

export async function run() {
  console.log('[nodes] Starting nodes refresh');
  while (!shouldStop) {
    try {
      nodesRefreshCount.inc();
      nodes = await getNodes();
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
