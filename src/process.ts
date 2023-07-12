import bandit from 'bayesian-bandit';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { AddressZero } from '@ethersproject/constants';
import dbq from './mysql';

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
  const [nodes]: any[] = await dbq.getUnarchivedNodes();

  await Promise.all(
    nodes.map(node => {
      const provider = new StaticJsonRpcProvider(node.url, Number(node.network));

      return provider
        .getBalance(AddressZero, 1)
        .then(() => dbq.setNodeAsArchive(true, node))
        .catch(() => dbq.setNodeAsArchive(false, node));
    })
  );
}

async function checkNetwork() {
  const [nodes]: any[] = await dbq.loadUndefinedNodes();

  await Promise.all(
    nodes.map(node => {
      const provider = new StaticJsonRpcProvider({ url: node.url, timeout: 20e3 });

      return provider
        .getNetwork()
        .then(n => dbq.setNetwork(node, n.chainId))
        .catch(() => dbq.setUndefinedNetwork(node));
    })
  );
}

async function loadNodes() {
  const [nodes]: any[] = await dbq.loadValidNodes();

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
