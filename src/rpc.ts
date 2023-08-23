import express, { Request, Response, NextFunction } from 'express';
import { hexlify } from '@ethersproject/bytes';
import redis, { EXPIRE_ARCHIVE } from './redis';
import { captureErr } from './sentry';
import { getRequestKey } from './utils';
import proxyRequest from './proxy';
import { networks } from './process-nodes';

const router = express.Router();

async function processEthMethods(req: Request, res: Response, next: NextFunction) {
  try {
    const { network } = req.params;
    const { method, id } = req.body;

    switch (method) {
      case 'eth_chainId': {
        const result = hexlify(Number(network));
        return res.json({ jsonrpc: '2.0', id, result });
      }
      case 'eth_getBalance':
      case 'eth_getBlockByHash':
      case 'eth_getBlockByNumber': {
        break;
      }
    }
    next();
  } catch (e) {
    captureErr(e);
    next(e);
  }
}

function defineArchive(req: Request, _res: Response, next: NextFunction) {
  const { params } = req.body;
  if (params && params[1] !== 'latest' && params[1] !== false) {
    req.params._archive = '_archive';
  }
  next();
}

function genRequestKey(req: Request, res: Response, next: NextFunction) {
  const { network } = req.params;
  const { method, params } = req.body;
  req.params._reqHashKey = getRequestKey(network, method, params);

  next();
}

async function processCached(req: Request, res: Response, next: NextFunction) {
  try {
    const { _reqHashKey: hashKey, _archive } = req.params;
    const exists = await redis.exists(hashKey);
    if (!exists) return next();

    const [ttlRemains, cache] = await redis.multi().ttl(hashKey).get(hashKey).exec();
    if (!cache) return next();

    const isArchive = Boolean(_archive);
    const isCalledOften = ttlRemains < EXPIRE_ARCHIVE / 10;

    if (isArchive && isCalledOften) {
      await redis.expire(hashKey, EXPIRE_ARCHIVE);
    }

    const data = JSON.parse(cache);
    data.id = req.body.id;
    return res.json(data);
  } catch (e) {
    captureErr(e);
    return next();
  }
}

function pickNode(req: Request, res: Response, next: NextFunction) {
  const { network, _archive } = req.params;
  const isArchive = Boolean(_archive);
  const networkKey = isArchive ? `${network}_1` : `${network}_0`;
  const networkData = networks[networkKey];

  if (!networkData) {
    captureErr(new Error(`No node for network ${network}`));
    return res.status(500).send('No node for network');
  }

  const [armIndex] = networkData.algorithm.orderedArms();
  req.params._arm = networkData.algorithm.arms[armIndex];
  req.params._node = networkData.nodes[armIndex];

  return next();
}

router.post(
  '/:network',
  processEthMethods,
  defineArchive,
  genRequestKey,
  processCached,
  pickNode,
  proxyRequest
);

export default router;
