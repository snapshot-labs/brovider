import express from 'express';
import proxy from 'express-http-proxy';
import { JsonRpcProvider } from '@ethersproject/providers';
import rpcs from './rpcs.json';

const router = express.Router();
const monitor = {};

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
  const node = rpcs[network] ? rpcs[network][0] : null;
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

router.get('/monitor', async (req, res) => {
  return res.json(monitor);
});

async function getBlockNumber(rpc) {
  try {
    const provider = new JsonRpcProvider(rpc);
    return await provider.getBlockNumber();
  } catch (e) {
    return 0;
  }
}

async function isFullArchive(rpc) {
  try {
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
    proxyReqPathResolver: req => req.nodeData.path
  })
);

async function check() {
  for (const network of Object.entries(rpcs)) {
    for (let i = 0; i < network[1].length; i++) {
      console.log('Check network', network[0], 'index', i);
      const rpc = network[1][i];
      const p = await Promise.all([getBlockNumber(rpc), isFullArchive(rpc)]);
      const result = {
        rpc,
        block_num: p[0],
        is_archive: p[1],
        ts: Math.round(Date.now() / 1e3)
      };
      if (!monitor[network[0]]) monitor[network[0]] = [];
      monitor[network[0]][i] = result;
    }
  }
  return check();
}

check();

export default router;
