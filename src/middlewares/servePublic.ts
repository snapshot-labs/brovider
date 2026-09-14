import { NextFunction, Request, Response } from 'express';
import { isLiveRequest } from '../helpers/classify';
import { publicNodeRequestCount } from '../helpers/metrics';
import { getHead, markFailed, selectNodes } from '../helpers/publicNodes';
import { fetchWithKeepAlive } from '../helpers/utils';

const PUBLIC_TIMEOUT = 5e3;

/** JSON-RPC "limit exceeded", returned by rate-limited nodes with HTTP 200. */
const LIMIT_EXCEEDED = -32005;

export default async function servePublic(req: Request, res: Response, next: NextFunction) {
  const { network } = (req as any)._node;
  const body = req.body;

  const head = getHead(network);
  if (head === null || !isLiveRequest(body, head)) return next();

  for (const url of selectNodes(network)) {
    try {
      const response = await fetchWithKeepAlive(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: PUBLIC_TIMEOUT,
        body: JSON.stringify(body)
      });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`status ${response.status}`);
      }

      const json = await response.json();
      if (json?.error?.code === LIMIT_EXCEEDED) throw new Error(json.error.message);

      publicNodeRequestCount.inc({ network, outcome: 'public_node' });
      return res.json(json);
    } catch (err) {
      console.log(`[public] ${network} ${url} failed: ${(err as Error).message}`);
      markFailed(network, url);
    }
  }

  publicNodeRequestCount.inc({ network, outcome: 'fallback' });
  next();
}
