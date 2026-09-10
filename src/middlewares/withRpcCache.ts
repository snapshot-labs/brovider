import { NextFunction, Request, Response } from 'express';
import { RPC_CLIENTS, RPC_METHODS } from '../constants';
import { headOf, HEX_BLOCK, Node } from '../helpers/chainHead';
import { readCache, writeCache } from '../helpers/lruCache';
import {
  metricLabel,
  rpcCacheCount,
  rpcRequestCount
} from '../helpers/metrics';
import serve from '../helpers/requestDeduplicator';
import { sha256 } from '../helpers/utils';

type Pending = {
  key: string;
  block: number;
  settle: (result?: string) => void;
};

const BLOCK_PARAM_INDEX = new Map([
  ['eth_call', 1],
  ['eth_getBalance', 1],
  ['eth_getCode', 1],
  ['eth_getStorageAt', 2]
]);

const CONFIRMATIONS = 128;

function pinnedBlock(body: any): number | undefined {
  const index = BLOCK_PARAM_INDEX.get(body?.method);
  if (index === undefined || !Array.isArray(body.params)) return undefined;

  const param = body.params[index];
  if (typeof param !== 'string' || !HEX_BLOCK.test(param)) return undefined;

  return parseInt(param, 16);
}

export default function withRpcCache(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const node: Node = (req as any)._node;
  const body = req.body;
  const block = pinnedBlock(body);
  const isNotification = !Object.hasOwn(body, 'id');

  const countRequest = () =>
    rpcRequestCount.inc({
      network: node.network,
      client: metricLabel(req.query.client, RPC_CLIENTS),
      rpc_method: metricLabel(body.method, RPC_METHODS)
    });

  if (block === undefined || isNotification) {
    rpcCacheCount.inc({ status: 'BYPASS' });
    countRequest();
    return next();
  }

  const key = sha256(
    `${node.url}:${body.method}:${JSON.stringify(body.params)}`
  );
  const reply = (result: string) =>
    res.json({ jsonrpc: '2.0', id: body.id, result });

  const cached = readCache(key);
  if (cached !== undefined) {
    rpcCacheCount.inc({ status: 'HIT' });
    return reply(cached);
  }
  rpcCacheCount.inc({ status: 'MISS' });
  countRequest();

  // Identical in-flight reads share one upstream call: the first one (the leader) goes through
  // the proxy and settles this promise from storeRpcResponse, the others answer from it.
  let settle: Pending['settle'] | undefined;
  const shared: Promise<string | undefined> = serve(
    key,
    () => new Promise(resolve => (settle = resolve)),
    []
  );
  if (!settle) {
    return shared
      .then(result =>
        result !== undefined ? reply(result) : withRpcCache(req, res, next)
      )
      .catch(next);
  }

  // Leader failed or went away before the decorator ran: release the followers to retry.
  res.on('close', () => settle!());
  (req as any)._cache = { key, block, settle };
  next();
}

export async function storeRpcResponse(
  proxyRes: unknown,
  data: Buffer,
  req: Request
) {
  const { key, block, settle }: Pending = (req as any)._cache;

  let payload: any;
  try {
    payload = JSON.parse(data.toString());
  } catch {
    return data;
  }

  if (payload?.error == null && typeof payload?.result === 'string') {
    settle(payload.result);
    const head = await headOf((req as any)._node);
    if (head !== null && block <= head - CONFIRMATIONS)
      writeCache(key, payload.result);
  }

  return data;
}
