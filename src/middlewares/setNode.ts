import { NextFunction, Request, Response } from 'express';
import { nodes } from '../helpers/data';

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

  (req as any)._node = {
    url,
    path: url.substring(url.indexOf('/', url.indexOf('://') + 3) || 0) || '/',
    network
  };

  next();
}
