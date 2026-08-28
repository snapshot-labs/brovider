import { capture } from '@snapshot-labs/snapshot-sentry';
import { NextFunction, Request, Response } from 'express';
import { RPC_CLIENTS, RPC_METHODS, RPC_NAMESPACES } from '../constants';
import { rpcRequestCount, rpcUnknownMethodCount } from '../helpers/metrics';
import { nodes } from '../helpers/nodes';

const NODE_HEADERS: Record<string, Record<string, string>> = {
  'https://internal-archive.storyrpc.io': {
    'x-snapshot-partner-key': process.env.STORY_PARTNER_KEY || ''
  },
  'https://internal-archive.aeneid.storyrpc.io': {
    'x-snapshot-partner-key': process.env.STORY_PARTNER_KEY_TESTNET || ''
  }
};

function metricLabel(value: unknown, allowed: Set<string>) {
  if (value === undefined) return 'none';
  return typeof value === 'string' && allowed.has(value) ? value : 'other';
}

function namespaceLabel(method: unknown) {
  if (typeof method !== 'string') return 'other';

  return metricLabel(method.split('_', 1)[0], RPC_NAMESPACES);
}

export default function setNode(req: Request, res: Response, next: NextFunction) {
  const network = req.params[0];
  const body = req.body;
  const id =
    body && (typeof body.id === 'string' || typeof body.id === 'number' || body.id === null)
      ? body.id
      : null;
  const url = Object.hasOwn(nodes, network) ? nodes[network] : undefined;

  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || body.method === '') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request' }
    });
  }

  const { jsonrpc, method } = body;

  if (!url) {
    return res.status(404).json({ jsonrpc, id, error: 'Invalid network' });
  }

  let path: string;
  try {
    const { pathname, search } = new URL(url);
    path = pathname + search;
  } catch (err) {
    capture(err, {
      contexts: {
        input: {
          network,
          url
        }
      }
    });
    return res.status(500).json({ jsonrpc, id, error: 'Invalid node URL configuration' });
  }

  rpcRequestCount.inc({
    network,
    client: metricLabel(req.query.client, RPC_CLIENTS),
    rpc_method: metricLabel(method, RPC_METHODS)
  });

  if (!RPC_METHODS.has(method)) {
    rpcUnknownMethodCount.inc({ namespace: namespaceLabel(method) });
  }

  (req as any)._node = {
    url,
    path,
    network,
    headers: NODE_HEADERS[url] || {}
  };

  next();
}
