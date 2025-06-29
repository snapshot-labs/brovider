import { NextFunction, Request, Response } from 'express';
import { subgraphs } from '../helpers/data';

export default function setDelegation(req: Request, res: Response, next: NextFunction) {
  if (!req.body) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const url = subgraphs.delegation[req.params.network];

  if (!url) {
    return res.status(400).json({ errors: [{ message: 'Invalid url' }] });
  }

  const parsedUrl = new URL(url);

  (req as any)._delegation = {
    url: `${parsedUrl.protocol}//${parsedUrl.host}`,
    path: parsedUrl.pathname
  };

  next();
}
