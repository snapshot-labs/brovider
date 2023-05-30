import express from 'express';
import Algorithm from 'egreedy';
import { createProxyMiddleware } from 'http-proxy-middleware';
import db from './mysql';

const router = express.Router();
const networks: Record<string, any> = {};

loadNodes().then(() => console.log('Nodes loaded'));

async function loadNodes() {
  const query = `
    SELECT *,
      CASE WHEN requests = 0 THEN 1000000
      ELSE (duration / requests)
      END AS average,
      CASE WHEN errors = 0 THEN 1000000
      ELSE (requests / errors)
      END AS rate
    FROM nodes
    ORDER BY rate DESC, average ASC
  `;
  const nodes = await db.queryAsync(query);

  nodes.forEach(node => {
    if (!networks[`_${node.network}`]) networks[`_${node.network}`] = { nodes: [] };
    networks[`_${node.network}`].nodes.push(node);
  });

  Object.keys(networks).forEach(id => {
    networks[id].id = id;
    networks[id].algorithm = new Algorithm({
      arms: networks[id].nodes.length,
      epsilon: 0.25
    });
  });

  nodes.forEach(node => {
    const i = networks[`_${node.network}`].nodes.findIndex(n => n.url === node.url);
    networks[`_${node.network}`].algorithm.reward(i, -Math.abs(node.average));
  });
}

async function onRouter(req) {
  const network = req.params.network;

  const node = await getNode(network);

  if (!node) return;

  req.params._node = node;

  return node.url;
}

function onProxyReq(proxyReq, req) {
  req.params._start = Date.now();
}

function onProxyRes(proxyRes, req) {
  const duration = Date.now() - req.params._start;

  const node = req.params._node;
  const i = networks[`_${node.network}`].nodes.findIndex(n => n.url === node.url);
  node.requests += 1;
  node.duration += duration;
  const average = node.duration / node.requests;
  node.average = average;
  const averageDiff = average - node.average;
  networks[`_${node.network}`].algorithm.reward(i, Math.abs(averageDiff) * -1);

  const query = 'UPDATE nodes SET requests = requests + 1, duration = duration + ? WHERE url = ?';
  db.queryAsync(query, [duration, req.params._node.url]);

  // reward
}

function onError(e, req) {
  const node = req.params._node;
  const i = networks[`_${node.network}`].nodes.findIndex(n => n.url === node.url);
  node.requests += 1;
  node.errors += 1;
  node.duration += 25e3;
  const average = node.duration / node.requests;
  node.average = average;
  const averageDiff = average - node.average;
  networks[`_${node.network}`].algorithm.reward(i, Math.abs(averageDiff) * -1);

  console.log('error', node.url, e);

  const query = `
    UPDATE nodes
    SET requests = requests + 1, errors = errors + 1, duration = duration + ?
    WHERE url = ?
  `;
  db.queryAsync(query, [25e3, node.url]);
}

async function getNode(network: string) {
  if (!networks[`_${network}`]?.nodes || networks[`_${network}`].nodes.length === 0) return false;

  const arm = await networks[`_${network}`].algorithm.select();

  const node = networks[`_${network}`].nodes[arm];
  // console.log('Arm', arm, node.url, node.provider, node.average);

  return node;
}

router.post(
  '/:network',
  createProxyMiddleware({
    secure: true,
    router: onRouter,
    changeOrigin: true,
    // logLevel: 'debug',
    ignorePath: true,
    proxyTimeout: 20e3,
    timeout: 20e3,
    onProxyReq,
    onProxyRes,
    onError
  })
);

export default router;
