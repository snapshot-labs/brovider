import express from 'express';
import proxy from 'express-http-proxy';
import { JsonRpcProvider } from '@ethersproject/providers';
import serve from './helpers/ee';
import rpcs from './rpcs.json';
import { RPC_LIST_WITH_KEYS, getBlock } from './utils';

const CACHE_METHODS = ['eth_chainId', 'eth_getBlockByNumber'];
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

function getPathFromURL(url) {
  const removePrefix = url.replace(/^(http|https):\/\//, '');
  return removePrefix.indexOf('/') > -1 ? removePrefix.substring(removePrefix.indexOf('/')) : '/';
}

function setNode(req, res, next) {
  const { network } = req.params;
  const node = RPC_LIST_WITH_KEYS[network] ? RPC_LIST_WITH_KEYS[network][0] : null;
  if (!node)
    return res
      .status(404)
      .json({ jsonrpc: req.body.jsonrpc, id: req.body.id, error: 'Network not found' });
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

router.get('/monitor', async (req, res) => {
  return res.json(monitor);
});

async function getBlockNumber(rpc) {
  try {
    if (typeof rpc === 'string') rpc = { url: rpc, timeout: 30000 };
    const provider = new JsonRpcProvider(rpc);
    return await provider.getBlockNumber();
  } catch (e) {
    return 0;
  }
}

async function isFullArchive(rpc) {
  try {
    if (typeof rpc === 'string') rpc = { url: rpc, timeout: 30000 };
    const provider = new JsonRpcProvider(rpc);
    await provider.getBalance('0xeF8305E140ac520225DAf050e2f71d5fBcC543e7', 1);
    return true;
  } catch (e) {
    return false;
  }
}

router.use(
  '/:network',
  setNode,
  proxy(req => req.nodeData.url, {
    timeout: 30000,
    memoizeHost: false,
    proxyReqOptDecorator: setAdditionalHeaders,
    proxyReqPathResolver: req => req.nodeData.path,
    filter: function (req) {
      if (req.body && CACHE_METHODS.includes(req.body.method)) {
        if (req.body.method === 'eth_getBlockByNumber' && req.body.params[0] === 'latest')
          return true;
        return false;
      }
      return true;
    }
  })
);

router.use('/:network', async (req, res) => {
  const network = req.params.network;
  const method = req.body.method;
  const jsonrpc = req.body.jsonrpc;
  const id = req.body.id;

  if (method === 'eth_chainId') {
    const result = `0x${Number(network).toString(16)}`;
    return res.json({ jsonrpc, id, result });
  }

  if (method === 'eth_getBlockByNumber') {
    const block = req.body.params[0];
    const key = `${method}:${network}:${block}`;
    const response: any = await serve(key, getBlock, [key, network, req.body]);
    return res.json({ jsonrpc, id, error: response.error, result: response.result });
  }

  res.json({ error: 'Method not found' });
});

let checkCount = 0;
async function check() {
  checkCount++;
  for (const [network, rpcList] of Object.entries(rpcs)) {
    for (let i = 0; i < rpcList.length; i++) {
      const rpc = rpcList[i];
      const [blockNumber, isArchive] = await Promise.all([getBlockNumber(rpc), isFullArchive(rpc)]);
      const oldSuccessTotal = monitor[network][i].success_total || 0;
      const successReward = blockNumber > 0 ? 1 : 0;
      const successTotal = oldSuccessTotal + successReward;
      const successScore = parseFloat(((successTotal * 100) / checkCount).toFixed(2));
      const result = {
        rpc,
        block_number: blockNumber,
        is_archive: isArchive,
        success_total: successTotal,
        success_score: successScore,
        ts: Math.round(Date.now() / 1e3)
      };
      monitor[network][i] = result;
    }
  }
  return check();
}

check();

export default router;
