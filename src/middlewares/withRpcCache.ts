import { IncomingMessage } from 'http';
import { NextFunction, Request, Response } from 'express';
import { RPC_CLIENTS, RPC_METHODS } from '../constants';
import { Family, familyOf, headOf } from '../helpers/chainHead';
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

type Pinned = { family: Family; block: number };

export type Pending = Pinned & {
  key: string;
  settle: (result?: string) => void;
};

// Cacheable methods, each with where its block argument sits in the params.
const at = (index: number) => (params: unknown) =>
  Array.isArray(params) ? (params[index] as unknown) : undefined;

const BLOCK_PARAM = new Map<string, (params: unknown) => unknown>([
  ['eth_call', at(1)],
  ['eth_getBalance', at(1)],
  ['eth_getCode', at(1)],
  ['eth_getStorageAt', at(2)]
]);

const CONFIRMATIONS = 128;

function pinnedBlock(body: JsonRpcRequest): Pinned | undefined {
  const blockParam = BLOCK_PARAM.get(body.method);
  if (blockParam === undefined) return undefined;

  const family = familyOf(body.method);
  if (family === undefined) return undefined;

  const block = family.parseBlock(blockParam(body.params));
  return block === undefined ? undefined : { family, block };
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
  const pinned = pinnedBlock(body);
  const isNotification = !Object.hasOwn(body, 'id');

  const countRequest = () =>
    rpcRequestCount.inc({
      network: node.network,
      client: metricLabel(req.query.client, RPC_CLIENTS),
      rpc_method: metricLabel(body.method, RPC_METHODS)
    });

  if (pinned === undefined || isNotification) {
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
  req._cache = { ...pinned, key, settle };
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
    const needed = pending.block + CONFIRMATIONS;
    const head = await headOf(req._node, pending.family, needed);
    if (head !== null && head >= needed) set(pending.key, result);
  }

  return data;
}
