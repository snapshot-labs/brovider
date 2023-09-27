import { Bandit } from 'bayesian-bandit';
import { Cron } from 'croner';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { captureErr } from './sentry';
import { AddressZero } from '@ethersproject/constants';
import groupBy from 'lodash/groupBy';
import dbq from './mysql';
import { sync, onSync } from './cluster-sync';

type NetworkDetails = {
  id: string;
  nodes: any[];
  algorithm: Bandit;
};
const cronJob = new Cron('* */20 * * * *'); // every 20 minutes
let isRunning = false;
let lastExecutionTimestamp = 0;
const EXECUTION_INTERVAL = 20 * 60e3; // 20 minutes

const ERROR_REWARD_MULTIPLIER = -25e3;
const DURATION_REWARD_MULTIPLIER = -1;
const processId = process.env.NODE_APP_INSTANCE ?? '0';

export function getErrorReward(errors = 1) {
  return errors * ERROR_REWARD_MULTIPLIER;
}

export function getDurationReward(duration = 0, requests = 1) {
  return Math.abs(duration) * DURATION_REWARD_MULTIPLIER * requests;
}

export const networks: Record<string, NetworkDetails> = {};

onSync('loadNodes', async () => {
  const nodes = await loadNodes();
  console.log(`Loaded ${nodes.length} nodes (pid: ${processId})`);
});

export async function startJob() {
  if (processId !== '0') return;
  await processNodes({ forced: true });

  return cronJob.schedule(processNodes);
}

export function stopJob() {
  console.log('Stop cron job process nodes');
  return cronJob.stop();
}

export async function processNodes(opts: any) {
  const { forced = false } = opts || {};

  if (isRunning) return;
  const now = Date.now();
  if (!forced && now - lastExecutionTimestamp < EXECUTION_INTERVAL) return;

  isRunning = true;
  try {
    if (process.env.NODE_ENV === 'production') {
      await checkNetwork();
      console.log('Check chain id done');
    }

    await checkArchive();
    console.log('Check archive done');

    const nodes = await loadNodes();
    console.log(`Loaded ${nodes.length} nodes (pid: ${processId})`);
    sync('loadNodes');
  } catch (error) {
    captureErr(error);
  } finally {
    isRunning = false;
    lastExecutionTimestamp = now;
  }
}

async function checkNetwork() {
  const [nodes]: any[] = await dbq.loadNodes();

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

async function checkArchive() {
  const [nodes]: any[] = await dbq.getUnknownArchiveNodes();

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
          sum: getErrorReward(node.errors) + getDurationReward(node.duration, node.requests)
        }))
      })
    };

    networks[id] = network;
  });

  return nodes;
}
