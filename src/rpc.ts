import express from 'express';
import bandit from 'bayesian-bandit';
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

async function onRouter(req) {
  const network = req.params.network;
  const node = getNode(network);
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

  if (proxyRes.statusCode !== 200) {
    console.log('error status', node.url);

    networks[`_${node.network}`].algorithm.arms[i].reward(-25e3);

    const query = 'UPDATE nodes SET requests = requests + 1, errors = errors + 1 WHERE url = ?';
    db.query(query, [node.url]);
  } else {
    networks[`_${node.network}`].algorithm.arms[i].reward(-Math.abs(duration));

    const query = 'UPDATE nodes SET requests = requests + 1, duration = duration + ? WHERE url = ?';
    db.query(query, [duration, req.params._node.url]);
  }
}

function onError(e, req) {
  const node = req.params._node;
  const i = networks[`_${node.network}`].nodes.findIndex(n => n.url === node.url);
  networks[`_${node.network}`].algorithm.arms[i].reward(-25e3);

  console.log('on error', node.url);

  const query = 'UPDATE nodes SET requests = requests + 1, errors = errors + 1 WHERE url = ?';
  db.query(query, [node.url]);
}

function getNode(network: string) {
  if (!networks[`_${network}`]?.nodes || networks[`_${network}`].nodes.length === 0) return false;
  const arm = networks[`_${network}`].algorithm.selectArm();

  return networks[`_${network}`].nodes[arm];
}

router.post(
  '/:network',
  createProxyMiddleware({
    secure: true,
    router: onRouter,
    changeOrigin: true,
    logLevel: 'silent',
    ignorePath: true,
    proxyTimeout: 20e3,
    timeout: 20e3,
    onProxyReq,
    onProxyRes,
    onError
  })
);

export default router;
