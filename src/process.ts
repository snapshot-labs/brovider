import { Bandit } from './bayesian-bandit';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { captureErr } from './sentry';
import { AddressZero } from '@ethersproject/constants';
import groupBy from 'lodash/groupBy';
import dbq from './mysql';

type NetworkDetails = {
  id: string;
  nodes: any[];
  algorithm: Bandit;
};
export const networks: Record<string, NetworkDetails> = {};

start();

async function start() {
  try {
    // await checkNetwork();
    console.log('Check chain id done');

    // await checkArchive();
    console.log('Check archive done');

    await loadNodes();
    console.log('Nodes loaded');
  } catch (error) {
    captureErr(error);
  }
}

async function checkArchive() {
  const [nodes]: any[] = await dbq.getArchiveNodes();

  const nodeArchiveMapping = await Promise.all(
    nodes.map(node => {
      const provider = new StaticJsonRpcProvider(node.url, Number(node.network));
      const onSuccess = () => ({ node, archive: true });
      const onError = () => ({ node, archive: false });
      return provider.getBalance(AddressZero, 1).then(onSuccess, onError);
    })
  );

  return dbq.setArchiveNodes(nodeArchiveMapping);
}

async function checkNetwork() {
  const [nodes]: any[] = await dbq.loadNodesWithoutChainId();

  const nodeChainIdMapping = await Promise.all(
    nodes.map(node => {
      const provider = new StaticJsonRpcProvider({ url: node.url, timeout: 20e3 });

      const onSuccess = n => ({ node, chainId: n.chainId });
      const onError = () => ({ node, chainId: 0 });

      return provider.getNetwork().then(onSuccess, onError);
    })
  );

  return dbq.setNetworkChainIds(nodeChainIdMapping);
}

async function loadNodes() {
  const [nodes]: any[] = await dbq.loadValidNodes();

  let groupedNodes: Record<string, any[]> = groupBy(nodes, function (item) {
    return `${item.network}_${item.archive}`;
  });

  groupedNodes = Object.entries(groupedNodes).reduce((acc: any, entry) => {
    const [key, value] = entry as [string, any[]];
    const [network, archive] = key.split('_');
    if (archive === '1') {
      acc[`${network}_0`] = acc[`${network}_0`] || [];
      acc[`${network}_0`].push(...value);
    }

    acc[key] = acc[key] || [];
    acc[key].push(...value);

    return acc;
  }, {});

  Object.entries(groupedNodes).forEach(([id, nodes]) => {
    const network: NetworkDetails = {
      id,
      nodes,
      algorithm: new Bandit({
        arms: nodes.map(node => ({
          count: node.requests,
          sum: -Math.abs(node.duration + node.errors * 25e3)
        }))
      })
    };

    networks[id] = network;
  });
}
