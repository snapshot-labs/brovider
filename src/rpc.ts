import express from 'express';
import networks from '@snapshot-labs/snapshot.js/src/networks.json';
import proxy from 'express-http-proxy';

const router = express.Router();

/*
 * Used to set the Authorization header for the proxy request
 */
function setAdditionalHeaders(proxyReqOpts, srcReq) {
  if (srcReq.nodeData.authHeader) {
    proxyReqOpts.headers['Authorization'] = srcReq.nodeData.authHeader;
  }
  return proxyReqOpts;
}

function getPathFromURL(url) {
  const removePrefix = url.replace(/^(http|https):\/\//, '');
  return removePrefix.indexOf('/') > -1 ? removePrefix.substring(removePrefix.indexOf('/')) : '/';
}

function setNode(req, res, next) {
  const { network } = req.params;
  const node = networks[network].rpc[0];
  const nodeURL = typeof node === 'object' ? node.url : node;
  const nodeData = {
    url: nodeURL,
    path: getPathFromURL(nodeURL),
    network,
    authHeader:
      typeof node === 'object' && node.user && node.password
        ? 'Basic ' + Buffer.from(node.user + ':' + node.password).toString('base64')
        : undefined
  };

  req.nodeData = nodeData;
  next();
}
router.use(
  '/s/:network',
  setNode,
  proxy(req => req.nodeData.url, {
    memoizeHost: false,
    proxyReqOptDecorator: setAdditionalHeaders,
    proxyReqPathResolver: req => req.nodeData.path
  })
);

export default router;
