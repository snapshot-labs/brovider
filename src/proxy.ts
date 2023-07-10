import { createProxyMiddleware, fixRequestBody, responseInterceptor } from 'http-proxy-middleware';
import db from './mysql';
import { networks } from './process';
import { getRequestKey } from './utils';
import redis from './redis';

function router(req) {
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

const onProxyRes = responseInterceptor(async (responseBuffer, proxyRes, req: any) => {
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

const proxyRequest = createProxyMiddleware({
  secure: true,
  changeOrigin: true,
  logLevel: 'silent',
  ignorePath: true,
  proxyTimeout: 20e3,
  timeout: 20e3,
  selfHandleResponse: true,
  router,
  onProxyReq,
  onProxyRes,
  onError
});

export default proxyRequest;