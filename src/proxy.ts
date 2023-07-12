import { createProxyMiddleware, fixRequestBody, responseInterceptor } from 'http-proxy-middleware';
import dbq from './mysql';
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

function handleError(node) {
  const i = networks[`_${node.network}`].nodes.findIndex(n => n.url === node.url);

  console.log('error status', node.url);

  networks[`_${node.network}`].algorithm.arms[i].reward(-25e3);

  // possible memory leak
  dbq.incErrors(node);
}

function updateReward(node, duration) {
  const indexOfNetwork = networks[`_${node.network}`].nodes.findIndex(n => n.url === node.url);
  networks[`_${node.network}`].algorithm.arms[indexOfNetwork].reward(-Math.abs(duration));

  // possible memory leak
  dbq.incDuration(node, duration);
}

const onProxyRes = responseInterceptor(async (responseBuffer, proxyRes, req: any) => {
  const node = req.params._node;

  if (proxyRes.statusCode !== 200) {
    handleError(node);
    return responseBuffer;
  }

  updateReward(node, Date.now() - req.params._start);

  let responseBody;
  try {
    responseBody = responseBuffer.toString('utf8');
  } catch (e) {
    console.log('error parsing response', e);
    return responseBuffer;
  }

  if (proxyRes.headers?.['content-type'] === 'application/json') {
    const options = req.params._archive ? { EX: 60 * 60 } : { EX: 3 };
    redis.set(req.params._key, responseBody, options);

    return responseBody;
  }

  return responseBuffer;
});

function onError(e, req) {
  if (!req) return;
  const node = req.params._node;
  handleError(node);
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
