import { NextFunction, Request, Response } from 'express';
import { nodes } from '../helpers/nodes';

export default function withCachedEthChain(req: Request, res: Response, next: NextFunction) {
  const network = req.params[0];
  const { method, jsonrpc, id } = req.body || {};

  if (jsonrpc === '2.0' && method === 'eth_chainId' && /^\d+$/.test(network)) {
    // Check if network exists before returning cached response
    if (!Object.hasOwn(nodes, network) || !nodes[network]) {
      return res.status(404).json({ jsonrpc, id, error: 'Invalid network' });
    }
    return res.json({ jsonrpc, id, result: `0x${Number(network).toString(16)}` });
  }

  next();
}
