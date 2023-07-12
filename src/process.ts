import bandit from 'bayesian-bandit';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { captureErr } from './sentry';
import { AddressZero } from '@ethersproject/constants';
import dbq from './mysql';

export const networks: Record<string, any> = {};

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
