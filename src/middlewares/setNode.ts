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

export default function setNode(req: Request, res: Response, next: NextFunction) {
  const network = req.params[0];
  const body = req.body;
  const isBatch = Array.isArray(body);
  const requests = isBatch ? body : [body];
  const id =
    !isBatch &&
    body &&
    typeof body === 'object' &&
    (typeof body.id === 'string' || typeof body.id === 'number' || body.id === null)
      ? body.id
      : null;
  const jsonrpc = isBatch ? '2.0' : body?.jsonrpc;
  const url = Object.hasOwn(nodes, network) ? nodes[network] : undefined;

  if (
    requests.length === 0 ||
    requests.some(
      request =>
        !request ||
        typeof request !== 'object' ||
        Array.isArray(request) ||
        request.jsonrpc !== '2.0'
    )
  ) {
    return res.status(400).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request' }
    });
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

  const client =
    typeof req.query.client === 'string' && RPC_CLIENTS.has(req.query.client)
      ? req.query.client
      : 'other';

  for (const request of requests) {
    rpcRequestCount.inc({
      network,
      client,
      method: RPC_METHODS.has(request.method) ? request.method : 'other'
    });
  }

  (req as any)._node = {
    url,
    path,
    network,
    headers: NODE_HEADERS[url] || {}
  };

  next();
}
