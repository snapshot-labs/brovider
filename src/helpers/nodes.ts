import db from './db';
import { sleep } from './utils';

export let nodes = {};

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
    console.log('[nodes] Refreshing nodes');
    nodes = await getNodes();
    await sleep(10e3);
  }
}

export function stop() {
  console.log('[nodes] Stopping nodes refresh');
  shouldStop = true;
}
