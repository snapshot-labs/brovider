import { capture } from '@snapshot-labs/snapshot-sentry';
import { NextFunction, Request, Response } from 'express';
import { nodes } from '../helpers/nodes';

export default function setNode(req: Request, res: Response, next: NextFunction) {
  const network = req.params.network;
  const body = req.body || {};
  const { jsonrpc, id } = body;
  const url = nodes[network];

  if (!req.body || !jsonrpc) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  if (!url) {
    return res.status(404).json({ jsonrpc, id, error: 'Invalid network' });
  }

  let path: string;
  try {
    path = new URL(url).pathname || '/';
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

  (req as any)._node = {
    url,
    path,
    network
  };

  next();
}
