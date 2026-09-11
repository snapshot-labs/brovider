import { IncomingMessage } from 'http';
import { NextFunction, Request, Response } from 'express';
import { RPC_CLIENTS, RPC_METHODS } from '../constants';
import { headOf, HEX_BLOCK } from '../helpers/chainHead';
import { get, set } from '../helpers/lruCache';
import {
  metricLabel,
  rpcCacheHitCount,
  rpcRequestCount
} from '../helpers/metrics';
import serve from '../helpers/requestDeduplicator';
import { sha256 } from '../helpers/utils';

type JsonRpcRequest = {
  method: string;
  params?: unknown;
  id?: string | number | null;
};

export type Pending = {
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

function pinnedBlock(body: JsonRpcRequest): number | undefined {
  const index = BLOCK_PARAM_INDEX.get(body.method);
  if (index === undefined || !Array.isArray(body.params)) return undefined;

  const param: unknown = body.params[index];
  if (typeof param !== 'string' || !HEX_BLOCK.test(param)) return undefined;

  return parseInt(param, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default function withRpcCache(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const node = req._node;
  const body: JsonRpcRequest = req.body;
  const block = pinnedBlock(body);
  const isNotification = !Object.hasOwn(body, 'id');

  const countRequest = () =>
    rpcRequestCount.inc({
      network: node.network,
      client: metricLabel(req.query.client, RPC_CLIENTS),
      rpc_method: metricLabel(body.method, RPC_METHODS)
    });

  if (block === undefined || isNotification) {
    rpcCacheHitCount.inc({ status: 'BYPASS' });
    countRequest();
    return next();
  }

  const key = sha256(
    `${node.url}:${body.method}:${JSON.stringify(body.params)}`
  );
  const reply = (result: string) =>
    res.json({ jsonrpc: '2.0', id: body.id, result });

  const cached = get(key);
  if (cached !== undefined) {
    rpcCacheHitCount.inc({ status: 'HIT' });
    return reply(cached);
  }
  rpcCacheHitCount.inc({ status: 'MISS' });
  countRequest();

  // Identical in-flight reads share one upstream call: the first one (the leader) goes through
  // the proxy and settles this promise from storeRpcResponse, the others answer from it.
  let settle: Pending['settle'] | undefined;
  const shared = serve(
    key,
    () => new Promise<string | undefined>(resolve => (settle = resolve)),
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
  req._cache = { key, block, settle };
  next();
}

export async function storeRpcResponse(
  proxyRes: IncomingMessage,
  data: Buffer,
  req: Request
) {
  // Only the buffered proxy instance calls this, and it is only chosen once _cache is set.
  const pending = req._cache;
  if (!pending) return data;

  let payload: unknown;
  try {
    payload = JSON.parse(data.toString());
  } catch {
    return data;
  }
  if (!isRecord(payload)) return data;

  const { error, result } = payload;
  if (error == null && typeof result === 'string') {
    pending.settle(result);
    const head = await headOf(req._node);
    if (head !== null && pending.block <= head - CONFIRMATIONS)
      set(pending.key, result);
  }

  return data;
}
