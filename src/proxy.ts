import { createProxyMiddleware, fixRequestBody, responseInterceptor } from 'http-proxy-middleware';
import { capture } from '@snapshot-labs/snapshot-sentry';
import dbq from './mysql';
import redis, { EXPIRE_ARCHIVE, EXPIRE_LATEST } from './redis';
import { getErrorReward, getDurationReward } from './process-nodes';

function router(req) {
  return req.params._node.url;
}

function onProxyReq(proxyReq, req) {
  req.params._start = Date.now();
  fixRequestBody(proxyReq, req);
}

function handleError(arm, node) {
  const reward = getErrorReward();
  arm.reward(reward);
  dbq.incErrors(node).catch(capture);
}

function updateReward(arm, node, duration) {
  const reward = getDurationReward(duration);
  arm.reward(reward);
  dbq.incDuration(node, duration).catch(capture);
}

const onProxyRes = responseInterceptor(async (responseBuffer, proxyRes, req: any, res: any) => {
  const { _node: node, _arm: arm } = req.params;
  let rawBody = '';
  let responseBody = {};
  try {
    rawBody = responseBuffer.toString('utf8');
    responseBody = JSON.parse(rawBody);
  } catch (e: any) {
    e.message = `Error parsing response body: ${rawBody}`;
    capture(e);
  }

  if (proxyRes.statusCode !== 200) {
    const err = new Error('Error status code');
    capture(err, {
      proxyUrl: node.url || req.url,
      method: req.method,
      params: req.params,
      body: req.body,
      response: res,
      statusCode: proxyRes.statusCode,
      proxyRes: responseBody
    });
    handleError(arm, node);
    return responseBuffer;
  }

  const duration = Date.now() - req.params._start;
  updateReward(arm, node, duration);

  try {
    const responseBody = responseBuffer.toString('utf8');
    if (
      proxyRes.headers?.['content-type']?.includes('application/json') &&
      typeof redis !== 'undefined'
    ) {
      const options = req.params._archive ? { EX: EXPIRE_ARCHIVE } : { EX: EXPIRE_LATEST };
      await redis.set(req.params._reqHashKey, responseBody, options);

      return responseBody;
    }
  } catch (e) {
    capture(e, {
      proxyUrl: node.url || req.url,
      method: req.method,
      params: req.params,
      body: req.body,
      response: res,
      statusCode: proxyRes.statusCode,
      proxyRes: responseBody
    });
    return responseBuffer;
  }

  return responseBuffer;
});

function onError(err, req, res) {
  if (!req) {
    capture(new Error('No request'));
    return res.status(500).send({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32603, message: 'Internal error' }
    });
  }
  const { _node: node, _arm: arm } = req.params;
  capture(err, {
    proxyUrl: node.url || req.url,
    method: req.method,
    params: req.params,
    body: req.body,
    response: res,
    statusCode: err.statusCode,
    proxyRes: err.message
  });
  handleError(arm, node);
  return res.status(500).send(err);
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
