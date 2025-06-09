import express from 'express';
import proxy from 'express-http-proxy';
import rpcs from './rpcs.json';
import { getNodeUrl } from './utils';

const CACHE_METHODS = ['eth_chainId'];

const RPC_LIST_WITH_KEYS = Object.fromEntries(
  Object.entries(rpcs).map(([networkId, rpcList]) => [
    networkId,
    rpcList.map(rpc => getNodeUrl(rpc))
  ])
);

const router = express.Router();

const monitor = Object.fromEntries(
  Object.keys(rpcs).map(networksId => [
    networksId,
    rpcs[networksId].map(rpc => ({
      rpc
    }))
  ])
);

// Set authorization header for the proxy request
function setAdditionalHeaders(proxyReqOpts, srcReq) {
  if (srcReq.nodeData.authHeader)
    proxyReqOpts.headers['Authorization'] = srcReq.nodeData.authHeader;
  return proxyReqOpts;
}

function getPathFromURL(url: string) {
  const removePrefix = url.replace(/^(http|https):\/\//, '');
  return removePrefix.indexOf('/') > -1 ? removePrefix.substring(removePrefix.indexOf('/')) : '/';
}

function setNode(req, res, next) {
  const { network } = req.params;
  const { jsonrpc, id } = req.body;
  const url = RPC_LIST_WITH_KEYS[network] ? RPC_LIST_WITH_KEYS[network][0] : null;

  if (!url) {
    return res.status(404).json({ jsonrpc, id, error: 'Network not found' });
  }

  req.nodeData = {
    url,
    path: getPathFromURL(url),
    network
  };

  next();
}

router.get('/monitor', async (req, res) => {
  return res.json(monitor);
});

router.use(
  '/:network',
  setNode,
  proxy(req => req.nodeData.url, {
    timeout: 30000,
    memoizeHost: false,
    proxyReqOptDecorator: setAdditionalHeaders,
    proxyReqPathResolver: req => req.nodeData.path,
    filter: function (req) {
      return !(req.body && CACHE_METHODS.includes(req.body.method));
    }
  })
);

router.use('/:network', async (req, res) => {
  const network = req.params.network;
  const { method, jsonrpc, id } = req.body;

  if (method && method === 'eth_chainId') {
    const result = `0x${Number(network).toString(16)}`;

    return res.json({ jsonrpc, id, result });
  }

  res.status(404).json({ jsonrpc, id, error: 'Method not found' });
});

export default router;
