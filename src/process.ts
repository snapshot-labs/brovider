import bandit from 'bayesian-bandit';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { AddressZero } from '@ethersproject/constants';
import db from './mysql';

export const networks: Record<string, any> = {};

start();

async function start() {
  // await checkNetwork();
  console.log('Check chain id done');

  // await checkArchive();
  console.log('Check archive done');

  await loadNodes();
  console.log('Nodes loaded');
}

async function checkArchive() {
  const [nodes]: any[] = await db.query(`SELECT * FROM nodes WHERE network != '' AND archive = -1`);

  await Promise.all(
    nodes.map(node => {
      const provider = new StaticJsonRpcProvider(node.url, Number(node.network));

      return provider
        .getBalance(AddressZero, 1)
        .then(() => db.query('UPDATE nodes SET archive = 1 WHERE url = ?', [node.url]))
        .catch(() => db.query('UPDATE nodes SET archive = 0 WHERE url = ?', [node.url]));
    })
  );
}

async function checkNetwork() {
  const [nodes]: any[] = await db.query(`SELECT * FROM nodes WHERE network = -1`);

  await Promise.all(
    nodes.map(node => {
      const provider = new StaticJsonRpcProvider({ url: node.url, timeout: 20e3 });

      return provider
        .getNetwork()
        .then(n => db.query('UPDATE nodes SET network = ? WHERE url = ?', [n.chainId, node.url]))
        .catch(() => db.query('UPDATE nodes SET network = 0 WHERE url = ?', [node.url]));
    })
  );
}

async function loadNodes() {
  const query = `SELECT * FROM nodes WHERE network != -1 AND network != 0 AND archive = 1`;
  const [nodes]: any[] = await db.query(query);

  nodes.forEach(node => {
    if (!networks[`_${node.network}`]) networks[`_${node.network}`] = { nodes: [] };
    networks[`_${node.network}`].nodes.push(node);
  });

  Object.keys(networks).forEach(id => {
    networks[id].id = id;
    networks[id].algorithm = new bandit.Bandit({
      arms: networks[id].nodes.map(node => ({
        count: node.requests,
        sum: -Math.abs(node.duration + node.errors * 25e3)
      }))
    });
  });
}
