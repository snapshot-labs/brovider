import { NextFunction, Request, Response } from 'express';
import { subgraphs } from '../helpers/data';

export default function setSubgraph(req: Request, res: Response, next: NextFunction) {
  if (!req.body) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const network = req.params.network;
  const subgraph = req.params.subgraph;

  const baseUrl = subgraphs.subgraph[network];
  if (!baseUrl) {
    return res.status(400).json({ errors: [{ message: 'Invalid url' }] });
  }

  const fullUrl = baseUrl + subgraph;
  const parsedUrl = new URL(fullUrl);

  (req as any)._subgraph = {
    url: `${parsedUrl.protocol}//${parsedUrl.host}`,
    path: parsedUrl.pathname
  };

  next();
}
