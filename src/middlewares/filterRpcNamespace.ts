import { NextFunction, Request, Response } from 'express';
import { NetworkFamily, networkFamily } from './withCachedChainId';
import { nodes } from '../helpers/nodes';

const NAMESPACE_PATTERNS: Record<NetworkFamily, RegExp> = {
  evm: /^(eth|net|web3|chain|state|hmyv2)_/,
  starknet: /^starknet_/
};

export default function filterRpcNamespace(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const network = req.params[0];
  const body = req.body;
  const { jsonrpc, id, method } = body;

  if (!Object.hasOwn(nodes, network) || !nodes[network]) return next();

  const family = networkFamily(network);

  if (!family || NAMESPACE_PATTERNS[family].test(method)) return next();

  if (!Object.hasOwn(body, 'id')) return res.status(204).end();

  return res.status(400).json({
    jsonrpc,
    id,
    error: { code: -32601, message: 'Method not found' }
  });
}
