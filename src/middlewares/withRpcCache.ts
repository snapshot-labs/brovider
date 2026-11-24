import http from 'node:http';
import https from 'node:https';
import { NextFunction, Request, Response } from 'express';
import {
  rpcCacheCount,
  rpcCacheMismatchCount,
  rpcCacheStoreCount
} from '../helpers/metrics';
import {
  config,
  get,
  pin,
  Pinned,
  set,
  tooRecent,
  updateHead
} from '../helpers/rpcCache';

// Cacheable reads are fetched here instead of through the proxy: a proxy
// response hook would make it buffer every response, while this path streams
// the node's bytes to the client as they arrive and keeps a copy on the side.

type Context = { network: string; method: string; pinned: Pinned };

class TimeoutError extends Error {}

const agents: Record<string, http.Agent> = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true })
};
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade'
]);
const CLOSE = Buffer.from('}');

// Identical requests in flight share the first one's answer
const TIMEOUT = Symbol('timeout');
type Shared = Buffer | null | typeof TIMEOUT;
const inflight = new Map<string, Promise<Shared>>();

// Same answer as express-http-proxy on timeout
function sendTimeout(res: Response) {
  res.setHeader('X-Timeout-Reason', 'express-http-proxy reset the request.');
  res.writeHead(504, { 'Content-Type': 'text/plain' });
  res.end();
}

function sendCached(req: any, res: Response, value: Buffer) {
  const id = req.body.id ?? null;
  const head = Buffer.from(
    `{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":`
  );
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': head.length + value.length + CLOSE.length,
    'x-brovider-cache': 'HIT'
  });
  res.write(head);
  res.write(value);
  res.end(CLOSE);
}

/** Checks the node's answer, stores it when allowed, returns it when valid. */
function settle(
  { network, method, pinned }: Context,
  status: number,
  encoding: string | undefined,
  chunks: Uint8Array[] | null,
  previous?: Buffer
): Buffer | null {
  const skip = (result: string, value: Buffer | null = null) => {
    rpcCacheStoreCount.inc({ network, rpc_method: method, result });
    return value;
  };

  if (status !== 200) return skip('status');
  if (encoding && encoding !== 'identity') return skip('encoded');
  if (!chunks) return skip('too_big');

  let body: any;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return skip('invalid');
  }
  if (!body || typeof body !== 'object' || body.error !== undefined) {
    return skip('error');
  }
  if (body.result === null || body.result === undefined) {
    return skip('null');
  }

  if (method === 'eth_getBlockByNumber') {
    const number = Number(body.result.number);
    if (Number.isSafeInteger(number)) updateHead(network, number);
  }

  const json = JSON.stringify(body.result);
  // Unpooled: a small Buffer.from() slice would keep an 8 KB pool block alive
  const value = Buffer.allocUnsafeSlow(Buffer.byteLength(json));
  value.write(json);
  if (previous && previous.toString('utf8') !== json) {
    rpcCacheMismatchCount.inc({ network, rpc_method: method });
  }

  // A node that has not seen the block yet also answers []
  if (method === 'eth_getLogs' && body.result.length === 0) {
    return skip('empty', value);
  }
  const reason =
    pinned.block === undefined ? null : tooRecent(network, pinned.block);
  if (reason) return skip(reason, value);

  set(pinned.key, value);
  return skip('stored', value);
}

function fetchUpstream(
  req: any,
  res: Response,
  next: NextFunction,
  ctx: Context,
  previous?: Buffer
): Promise<Shared> {
  return new Promise(resolve => {
    const node = req._node;
    const url = new URL(node.url);
    const body = Buffer.from(JSON.stringify(req.body));
    const headers: Record<string, string | number> = {
      accept: 'application/json',
      'content-type': 'application/json',
      'content-length': body.length,
      ...node.headers
    };
    if (req.headers['user-agent']) {
      headers['user-agent'] = req.headers['user-agent'];
    }

    const upstream = (url.protocol === 'http:' ? http : https).request(
      url,
      { method: 'POST', agent: agents[url.protocol], headers },
      up => {
        const status = up.statusCode ?? 502;
        const outHeaders: http.OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(up.headers)) {
          if (!HOP_BY_HOP.has(name) && value !== undefined) {
            outHeaders[name] = value;
          }
        }
        res.writeHead(status, outHeaders);

        let chunks: Uint8Array[] | null = [];
        let size = 0;
        up.on('data', (chunk: Uint8Array) => {
          if (!chunks) return;
          size += chunk.length;
          if (size > config.maxEntryBytes) chunks = null;
          else chunks.push(chunk);
        });
        up.on('end', () => {
          clearTimeout(timer);
          // After the client got its bytes, so storing never delays it
          setImmediate(() =>
            resolve(
              settle(
                ctx,
                status,
                up.headers['content-encoding'],
                chunks,
                previous
              )
            )
          );
        });
        up.on('error', () => {
          clearTimeout(timer);
          res.destroy();
          resolve(null);
        });
        up.pipe(res);
      }
    );

    const timer = setTimeout(
      () => upstream.destroy(new TimeoutError()),
      config.timeout
    );

    upstream.on('error', err => {
      clearTimeout(timer);
      const timedOut = err instanceof TimeoutError;
      resolve(timedOut ? TIMEOUT : null);
      if (res.headersSent) return res.destroy();
      if (timedOut) return sendTimeout(res);
      // Hand over to the proxy, as if this cache did not exist
      next();
    });

    upstream.end(body);
  });
}

export default function withRpcCache(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (config.mode === 'off') return next();

  // validateJsonRpc and setNode ran before, so body and node are set
  const { method, params } = req.body;
  const network: string = (req as any)._node.network;
  const pinned = pin(network, method, params);
  if (!pinned) {
    rpcCacheCount.inc({ network, rpc_method: 'other', result: 'unpinned' });
    return next();
  }

  const ctx = { network, method, pinned };
  const count = (result: string) =>
    rpcCacheCount.inc({ network, rpc_method: method, result });
  const run = () => {
    // cached is only set here in shadow mode, to compare with the node
    const promise = fetchUpstream(req, res, next, ctx, cached);
    if (!inflight.has(pinned.key)) {
      inflight.set(pinned.key, promise);
      promise.finally(() => {
        if (inflight.get(pinned.key) === promise) inflight.delete(pinned.key);
      });
    }
  };

  const cached = get(pinned.key);
  const pending = inflight.get(pinned.key);

  if (config.mode === 'on' && cached) {
    count('hit');
    return sendCached(req, res, cached);
  }
  if (config.mode === 'on' && pending) {
    count('shared');
    pending
      .then(value =>
        value === TIMEOUT
          ? sendTimeout(res)
          : value
            ? sendCached(req, res, value)
            : run()
      )
      .catch(() => (res.headersSent ? res.destroy() : run()));
    return;
  }

  // In shadow mode these are what the cache would have done
  count(cached ? 'hit' : pending ? 'shared' : 'miss');
  run();
}
