import db from './db';
import { sleep } from './utils';

export let nodes = {};

async function getNodes() {
  const keys = await db.query('SELECT * FROM keys');
  const nodes = await db.query('SELECT * FROM nodes WHERE main = 1');

  return nodes.reduce((result, node) => {
    result[node.network] = keys.reduce(
      (url, key) => url.replace(`\${${key.id}}`, key.value),
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
