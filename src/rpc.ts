import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import db from './mysql';
import { networks } from './process';

const router = express.Router();

function onRouter(req) {
  const network = req.params.network;

  if (!networks[`_${network}`]) {
    console.log('error no node for network', network);
    return undefined;
  }

  const arm = networks[`_${network}`].algorithm.selectArm();
  req.params._node = networks[`_${network}`].nodes[arm];

  return req.params._node.url;
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
  if (!req) return;

  const node = req.params._node;
  const i = networks[`_${node.network}`].nodes.findIndex(n => n.url === node.url);
  networks[`_${node.network}`].algorithm.arms[i].reward(-25e3);

  console.log('on error', node.url);

  const query = 'UPDATE nodes SET requests = requests + 1, errors = errors + 1 WHERE url = ?';
  db.query(query, [node.url]);
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
