import { NextFunction, Request, Response } from 'express';
import { nodes } from '../helpers/nodes';

const STARKNET_CHAIN_IDS: Record<string, string> = {
  sn: '0x534e5f4d41494e',
  'sn-sep': '0x534e5f5345504f4c4941'
};

function chainIdOf(network: string, method: unknown): string | undefined {
  if (method === 'eth_chainId' && /^\d+$/.test(network)) {
    return `0x${Number(network).toString(16)}`;
  }

  if (method === 'starknet_chainId' && Object.hasOwn(STARKNET_CHAIN_IDS, network)) {
    return STARKNET_CHAIN_IDS[network];
  }

  return undefined;
}

function isValidChainIdRequest(body: Record<string, unknown>): boolean {
  const { id, params } = body;

  return (
    Object.hasOwn(body, 'id') &&
    (typeof id === 'string' || typeof id === 'number' || id === null) &&
    (!Object.hasOwn(body, 'params') || (Array.isArray(params) && params.length === 0))
  );
}

export default function withCachedChainId(req: Request, res: Response, next: NextFunction) {
  const network = req.params[0];
  const body = req.body || {};
  const { method, jsonrpc, id } = body;

  const result = isValidChainIdRequest(body) ? chainIdOf(network, method) : undefined;

  if (result === undefined) return next();

  if (!Object.hasOwn(nodes, network) || !nodes[network]) {
    return res.status(404).json({ jsonrpc, id, error: 'Invalid network' });
  }

  return res.json({ jsonrpc, id, result });
}
