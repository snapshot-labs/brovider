import { capture } from '@snapshot-labs/snapshot-sentry';
import { NextFunction, Request, Response } from 'express';
import { RPC_CLIENTS, RPC_METHODS } from '../constants';
import { rpcRequestCount } from '../helpers/metrics';
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

export default function setNode(req: Request, res: Response, next: NextFunction) {
  const network = req.params[0];
  const body = req.body || {};
  const { jsonrpc, id } = body;
  const url = Object.hasOwn(nodes, network) ? nodes[network] : undefined;

  if (!req.body || !jsonrpc) {
    return res.status(400).json({ error: 'Invalid request' });
  }

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
    rpc_method: metricLabel(body.method, RPC_METHODS)
  });

  (req as any)._node = {
    url,
    path,
    network,
    headers: NODE_HEADERS[url] || {}
  };

  next();
}
