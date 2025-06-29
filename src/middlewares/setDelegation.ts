import { capture } from '@snapshot-labs/snapshot-sentry';
import { NextFunction, Request, Response } from 'express';
import { subgraphs } from '../helpers/data';

export default function setDelegation(req: Request, res: Response, next: NextFunction) {
  if (!req.body) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const network = req.params.network;
  const url = subgraphs.delegation[network];

  if (!url) {
    return res.status(400).json({ errors: [{ message: 'Invalid url' }] });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (err) {
    capture(err, {
      contexts: {
        input: {
          network,
          url
        }
      }
    });
    return res.status(500).json({ error: 'Invalid delegation URL configuration' });
  }

  (req as any)._delegation = {
    url: `${parsedUrl.protocol}//${parsedUrl.host}`,
    path: parsedUrl.pathname
  };

  next();
}
