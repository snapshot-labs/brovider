import { capture } from '@snapshot-labs/snapshot-sentry';
import { NextFunction, Request, Response } from 'express';
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

  (req as any)._node = {
    url,
    path,
    network,
    headers: NODE_HEADERS[url] || {}
  };

  next();
}
