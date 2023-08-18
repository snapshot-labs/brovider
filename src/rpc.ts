import express, { Request, Response, NextFunction } from 'express';
import { hexlify } from '@ethersproject/bytes';
import redis from './redis';
import { getRequestKey } from './utils';
import proxyRequest from './proxy';

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
    next(e);
  }
}

async function processCached(req, res: Response, next: NextFunction) {
  try {
    const { network } = req.params;
    const { method, params, id } = req.body;

    const key = getRequestKey(network, method, params);
    const exists = await redis.exists(key);
    if (!exists) return next();

    const cache = await redis.get(req.key);
    if (!cache) return next();

    const data = JSON.parse(cache);
    data.id = req.body.id;
    return res.json(data);
  } catch (e) {
    return next(e);
  }
}

router.post('/:network', processEthMethods, processCached, proxyRequest);

export default router;
