import express from 'express';
import proxy from 'express-http-proxy';
import rpc from './networkRPC.json';

const router = express.Router();

// Set authorization header for the proxy request
function setAdditionalHeaders(proxyReqOpts, srcReq) {
  if (srcReq.nodeData.authHeader)
    proxyReqOpts.headers['Authorization'] = srcReq.nodeData.authHeader;
  return proxyReqOpts;
}

function getPathFromURL(url) {
  const removePrefix = url.replace(/^(http|https):\/\//, '');
  return removePrefix.indexOf('/') > -1 ? removePrefix.substring(removePrefix.indexOf('/')) : '/';
}

function setNode(req, res, next) {
  const { network } = req.params;
  const node = rpc[network] ? rpc[network][0] : null;
  if (!node) return res.status(404).send('Network not found');
  const nodeURL = typeof node === 'object' ? node.url : node;
  req.nodeData = {
    url: nodeURL,
    path: getPathFromURL(nodeURL),
    network,
    authHeader:
      typeof node === 'object' && node.user && node.password
        ? 'Basic ' + Buffer.from(`${node.user}:${node.password}`).toString('base64')
        : undefined
  };
  next();
}

router.use(
  '/:network',
  setNode,
  proxy(req => req.nodeData.url, {
    timeout: 30000,
    memoizeHost: false,
    proxyReqOptDecorator: setAdditionalHeaders,
    proxyReqPathResolver: req => req.nodeData.path
  })
);

export default router;
