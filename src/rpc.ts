import crypto from 'crypto';
import { EventEmitter } from 'events';
import express from 'express';
import fetch from 'node-fetch';
// import { JsonRpcProvider } from '@ethersproject/providers';
import rpcs from './rpcs.json';

const CACHE_METHODS = ['eth_chainId'];

const ANKR_KEY = process.env.ANKR_KEY;
const DRPC_KEY = process.env.DRPC_KEY;
const FILECOIN_KEY = process.env.FILECOIN_KEY;

const RPC_LIST_WITH_KEYS = {};
for (const networkId in rpcs) {
  const rpcList = rpcs[networkId].map(rpc => {
    if (ANKR_KEY && rpc.startsWith('https://rpc.ankr.com/')) {
      return `${rpc}/${ANKR_KEY}`;
    }
    if (DRPC_KEY && rpc.startsWith('https://lb.drpc.org/ogrpc')) {
      return `${rpc}&dkey=${DRPC_KEY}`;
    }
    if (FILECOIN_KEY && rpc === 'https://calibration.node.glif.io/archive/lotus/rpc/v1') {
      return `${rpc}?token=${FILECOIN_KEY}`;
    }
    return rpc;
  });

  RPC_LIST_WITH_KEYS[networkId] = rpcList;
}

const router = express.Router();
const monitor = Object.fromEntries(
  Object.keys(rpcs).map(networksId => [
    networksId,
    rpcs[networksId].map(rpc => ({
      rpc
    }))
  ])
);

// Request deduplication cache
const requestCache = new Map();
const eventEmitter = new EventEmitter();
eventEmitter.setMaxListeners(5000);

function sha256(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Request deduplication middleware
function deduplicateRequests(req: any, res: any, next: any) {
  if (!req.body) return next();

  const cacheKey = sha256(
    JSON.stringify({
      url: req.nodeData.url,
      path: req.nodeData.path,
      body: req.body
    })
  );

  // Check if request is already in progress
  if (requestCache.has(cacheKey)) {
    // Wait for the existing request to complete
    eventEmitter.once(cacheKey, result => {
      if (result.error) {
        return res.status(500).json(result.error);
      }
      return res.json(result.data);
    });
    return;
  }

  // Mark request as in progress
  requestCache.set(cacheKey, true);
  req.cacheKey = cacheKey;
  next();
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
        ? `Basic ${Buffer.from(`${node.user}:${node.password}`).toString('base64')}`
        : undefined
  };
  next();
}

router.get('/monitor', async (req, res) => {
  return res.json(monitor);
});

// async function getBlockNumber(rpc) {
//   try {
//     if (typeof rpc === 'string') rpc = { url: rpc, timeout: 30000 };
//     const provider = new JsonRpcProvider(rpc);
//     return await provider.getBlockNumber();
//   } catch (e) {
//     return 0;
//   }
// }

// async function isFullArchive(rpc) {
//   try {
//     if (typeof rpc === 'string') rpc = { url: rpc, timeout: 30000 };
//     const provider = new JsonRpcProvider(rpc);
//     await provider.getBalance('0xeF8305E140ac520225DAf050e2f71d5fBcC543e7', 1);
//     return true;
//   } catch (e) {
//     return false;
//   }
// }

// Custom proxy handler with deduplication
function handleProxyRequest(req: any, res: any, next: any) {
  if (req.body && CACHE_METHODS.includes(req.body.method)) {
    return next();
  }

  const url = req.nodeData.url + req.nodeData.path;
  const options: any = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...req.headers
    },
    body: JSON.stringify(req.body),
    timeout: 30000
  };

  // Add authorization if needed
  if (req.nodeData.authHeader) {
    options.headers['Authorization'] = req.nodeData.authHeader;
  }

  fetch(url, options)
    .then((response: any) => response.json())
    .then((data: any) => {
      // Cache cleanup and event emission
      if (req.cacheKey) {
        requestCache.delete(req.cacheKey);
        eventEmitter.emit(req.cacheKey, { data });
      }
      res.json(data);
    })
    .catch(() => {
      // Cache cleanup and error emission
      if (req.cacheKey) {
        requestCache.delete(req.cacheKey);
        eventEmitter.emit(req.cacheKey, {
          error: { jsonrpc: req.body?.jsonrpc, id: req.body?.id, error: 'Proxy request failed' }
        });
      }
      res
        .status(500)
        .json({ jsonrpc: req.body?.jsonrpc, id: req.body?.id, error: 'Proxy request failed' });
    });
}

router.use('/:network', setNode, deduplicateRequests, handleProxyRequest);

router.use('/:network', async (req, res) => {
  const network = req.params.network;
  const { method, jsonrpc, id } = req.body;

  if (method && method === 'eth_chainId') {
    const result = `0x${Number(network).toString(16)}`;

    return res.json({ jsonrpc, id, result });
  }

  res.status(404).json({ jsonrpc, id, error: 'Method not found' });
});

// let checkCount = 0;
// async function check() {
//   checkCount++;
//   for (const [network, rpcList] of Object.entries(rpcs)) {
//     for (let i = 0; i < rpcList.length; i++) {
//       // console.log('Check network', network, 'index', i);
//       const rpc = rpcList[i];
//       const [blockNumber, isArchive] = await Promise.all([getBlockNumber(rpc), isFullArchive(rpc)]);
//       const oldSuccessTotal = monitor[network][i].success_total || 0;
//       const successReward = blockNumber > 0 ? 1 : 0;
//       const successTotal = oldSuccessTotal + successReward;
//       const successScore = parseFloat(((successTotal * 100) / checkCount).toFixed(2));
//       const result = {
//         rpc,
//         block_number: blockNumber,
//         is_archive: isArchive,
//         success_total: successTotal,
//         success_score: successScore,
//         ts: Math.round(Date.now() / 1e3)
//       };
//       monitor[network][i] = result;
//     }
//   }
//   return check();
// }

// check();

export default router;
