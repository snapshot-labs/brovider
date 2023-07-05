import express from 'express';
import { createProxyMiddleware, fixRequestBody, responseInterceptor } from 'http-proxy-middleware';
import { hexlify } from '@ethersproject/bytes';
import db from './mysql';
import redis from './redis';
import { networks } from './process';
import { getRequestKey, storeRequest } from './utils';

const router = express.Router();

async function cacheMiddleware(req, res, next) {
  try {
    const { network } = req.params;
    const { method, params, id } = req.body;
    const key = getRequestKey(network, method, params);
    const archive = params && (params[1] === 'latest' || params[1] === false) ? 0 : 1;

    switch (method) {
      case 'eth_chainId': {
        const result = hexlify(Number(network));
        storeRequest(network, method, archive, 1);

        return res.json({ jsonrpc: '2.0', id, result });
      }
      case 'eth_getBalance': {
        // console.log('eth_getBalance', network, params, id);
        break;
      }
      case 'eth_getBlockByHash': {
        // console.log('eth_getBlockByHash', network, params, id);
        break;
      }
      case 'eth_getBlockByNumber': {
        // console.log('eth_getBlockByNumber', network, params, id);
        break;
      }
      default: {
        console.log('unknown method', method, network, id);
      }
    }

    if (await redis.exists(key)) {
      const cache = await redis.get(key);

      if (cache) {
        try {
          const data = JSON.parse(cache);
          data.id = id;
          storeRequest(network, method, archive, 1);

          return res.json(data);
        } catch (e) {
          console.log('error parsing cache', e);
          return res.status(500).send('Error parsing cache');
        }
      }
    }

    storeRequest(network, method, archive, 0);

    next();
  } catch (e) {
    console.log('wrong format', e);
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
  const { network } = req.params;
  const { method, params } = req.body;

  req.params._start = Date.now();
  req.params._key = getRequestKey(network, method, params);
  req.params._archive = params && (params[1] === 'latest' || params[1] === false) ? 0 : 1;

  fixRequestBody(proxyReq, req);
}

const interceptor = responseInterceptor(async (responseBuffer, proxyRes, req: any) => {
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

  if (proxyRes.statusCode === 200 && proxyRes.headers?.['content-type'] === 'application/json') {
    const options = req.params._archive ? { EX: 60 * 60 } : { EX: 3 };
    redis.set(req.params._key, responseBuffer.toString('utf8'), options);

    return responseBuffer.toString('utf8');
  }

  return responseBuffer;
});

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
    selfHandleResponse: true,
    onProxyReq,
    onProxyRes: interceptor,
    onError
  })
);

export default router;
