import { NextFunction, Request, Response } from 'express';
import { NetworkFamily, networkFamily } from './withCachedChainId';
import { rpcNamespaceMismatchCount } from '../helpers/metrics';
import { nodes } from '../helpers/nodes';

const NAMESPACE_PATTERNS: Record<NetworkFamily, RegExp> = {
  evm: /^(eth|net|web3)_/,
  starknet: /^starknet_/
};

const KNOWN_PREFIXES = new Set(['eth', 'net', 'web3', 'starknet']);

function namespacePrefix(method: string): string {
  const parts = method.split('_');
  const prefix = parts.length > 1 ? parts[0] : '';
  return KNOWN_PREFIXES.has(prefix) ? prefix : 'other';
}

export default function measureRpcNamespace(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const network = req.params[0];
  const { method } = req.body;

  if (Object.hasOwn(nodes, network) && nodes[network]) {
    const family = networkFamily(network);

    if (family && !NAMESPACE_PATTERNS[family].test(method)) {
      rpcNamespaceMismatchCount.inc({
        network_family: family,
        prefix: namespacePrefix(method)
      });
    }
  }

  next();
}
