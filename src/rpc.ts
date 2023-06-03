import express from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { hexlify } from '@ethersproject/bytes';
import db from './mysql';
import { networks } from './process';

const router = express.Router();

function cacheMiddleware(req, res, next) {
  try {
    const { network } = req.params;
    const { method, params, id } = req.body;

    const archive = params[1] === 'latest' || params[1] === false ? 0 : 1;
    const request = { method, archive, count: 1 };
    const query = 'INSERT IGNORE INTO requests SET ? ON DUPLICATE KEY UPDATE count = count + 1';
    db.query(query, [request]);

    switch (method) {
      case 'eth_chainId': {
        const result = hexlify(Number(network));

        return res.json({ jsonrpc: '2.0', id, result });
      }
      case 'eth_getBalance': {
        console.log('eth_getBalance', network, params, id);
        break;
      }
      case 'eth_getBlockByHash': {
        console.log('eth_getBlockByHash', network, params, id);
        break;
      }
      case 'eth_getBlockByNumber': {
        console.log('eth_chainId', network, params, id);
        break;
      }
      default: {
        console.log(method, network, id);
      }
    }

    next();
  } catch (e) {
    console.log('wrong format');
  }
}

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
  fixRequestBody(proxyReq, req);
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
  cacheMiddleware,
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
