import db from './db';
import { sleep } from './utils';

export let nodes = {};
export let subgraphs = { subgraph: {}, delegation: {} };

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

async function getSubgraphs() {
  const graphs = await db.query('SELECT * FROM graph');

  return graphs.reduce(
    (result, graph) => {
      if (graph.type === 'subgraph') {
        result.subgraph[graph.network] = graph.url;
      } else if (graph.type === 'delegation') {
        result.delegation[graph.network] = graph.url;
      }
      return result;
    },
    { subgraph: {}, delegation: {} }
  );
}

export async function run() {
  while (!shouldStop) {
    nodes = await getNodes();
    subgraphs = await getSubgraphs();
    await sleep(10e3);
  }
}

export function stop() {
  shouldStop = true;
}
