import { NextFunction, Request, Response } from 'express';
import { isLiveRequest } from '../helpers/classify';
import { publicNodeRequestCount } from '../helpers/metrics';
import { getHead, markFailed, selectNodes } from '../helpers/publicNodes';
import { fetchWithKeepAlive } from '../helpers/utils';

/** Total time one request may spend on public nodes before falling back to main. */
const PUBLIC_BUDGET = 5e3;
/** Cap per node so a stalled node leaves budget for the next one. */
const ATTEMPT_TIMEOUT = 2.5e3;

/** JSON-RPC "limit exceeded", returned by rate-limited nodes with HTTP 200. */
const LIMIT_EXCEEDED = -32005;

export default async function servePublic(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { network } = (req as any)._node;
  const body = req.body;

  const head = getHead(network);
  if (head === null || !isLiveRequest(body, head)) return next();

  const deadline = Date.now() + PUBLIC_BUDGET;

  for (const url of selectNodes(network)) {
    const timeout = Math.min(ATTEMPT_TIMEOUT, deadline - Date.now());
    if (timeout <= 0) break;

    try {
      const response = await fetchWithKeepAlive(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout,
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(`status ${response.status}`);

      const json = JSON.parse(response.text);
      if (json?.error?.code === LIMIT_EXCEEDED)
        throw new Error(json.error.message);

      publicNodeRequestCount.inc({ network, outcome: 'public_node' });
      return res.json(json);
    } catch (err) {
      console.log(
        `[public] ${network} ${url} failed: ${(err as Error).message}`
      );
      markFailed(network, url);
    }
  }

  publicNodeRequestCount.inc({ network, outcome: 'fallback' });
  next();
}
