import db from './db';
import { sleep } from './utils';

export let nodes = {};

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

async function run() {
  while (true) {
    nodes = await getNodes();
    await sleep(10e3);
  }
}

run();
