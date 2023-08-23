import { createProxyMiddleware, fixRequestBody, responseInterceptor } from 'http-proxy-middleware';
import { captureProxy, captureErr } from './sentry';
import dbq from './mysql';
import redis, { EXPIRE_ARCHIVE, EXPIRE_LATEST } from './redis';

function router(req) {
  return req.params._node.url;
}

function onProxyReq(proxyReq, req) {
  req.params._start = Date.now();
  fixRequestBody(proxyReq, req);
}

function handleError(arm, node) {
  arm.reward(-25e3);
  dbq.incErrors(node).catch(captureErr);
}

function updateReward(arm, node, duration) {
  arm.reward(-Math.abs(duration));
  dbq.incDuration(node, duration).catch(captureErr);
}

const onProxyRes = responseInterceptor(async (responseBuffer, proxyRes, req: any, res: any) => {
  const { _node: node, _arm: arm } = req.params;

  if (proxyRes.statusCode !== 200) {
    const err = new Error('Error status code');
    captureProxy(err, req, res, node.url);
    handleError(arm, node);
    return responseBuffer;
  }

  const duration = Date.now() - req.params._start;
  updateReward(arm, node, duration);

  try {
    const responseBody = responseBuffer.toString('utf8');
    if (proxyRes.headers?.['content-type']?.includes('application/json')) {
      const options = req.params._archive ? { EX: EXPIRE_ARCHIVE } : { EX: EXPIRE_LATEST };
      await redis.set(req.params._reqHashKey, responseBody, options);

      return responseBody;
    }
  } catch (e) {
    captureProxy(e, req, res, node.url);
    return responseBuffer;
  }

  return responseBuffer;
});

function onError(e, req, res, target) {
  if (!req) return;
  const { _node: node, _arm: arm } = req.params;
  captureProxy(e, req, res, target);
  handleError(arm, node);
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
