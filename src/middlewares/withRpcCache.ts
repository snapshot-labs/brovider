import { IncomingMessage } from 'http';
import { NextFunction, Request, Response } from 'express';
import { RPC_CLIENTS, RPC_METHODS } from '../constants';
import { Family, familyOf, headOf } from '../helpers/chainHead';
import { get, MAX_VALUE_SIZE, set } from '../helpers/lruCache';
import {
  metricLabel,
  rpcCacheHitCount,
  rpcRequestCount
} from '../helpers/metrics';
import { Node } from '../helpers/nodes';
import { sha256 } from '../helpers/utils';

type JsonRpcRequest = {
  method: string;
  params?: unknown;
  id?: string | number | null;
};

type Pinned = { family: Family; block: number };

export type Pending = Pinned & { key: string };

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

  const cacheLabels = {
    network: node.network,
    rpc_method: metricLabel(body.method, RPC_METHODS)
  };
  const countRequest = () =>
    rpcRequestCount.inc({
      ...cacheLabels,
      client: metricLabel(req.query.client, RPC_CLIENTS)
    });

  if (pinned === undefined || isNotification) {
    rpcCacheHitCount.inc({ status: 'BYPASS', ...cacheLabels });
    countRequest();
    return next();
  }

  const key = sha256(
    `${node.url}:${body.method}:${JSON.stringify(body.params)}`
  );

  const cached = get(key);
  if (cached !== undefined) {
    rpcCacheHitCount.inc({ status: 'HIT', ...cacheLabels });
    return res.json({ jsonrpc: '2.0', id: body.id, result: cached });
  }

  rpcCacheHitCount.inc({ status: 'MISS', ...cacheLabels });
  countRequest();
  req._cache = { ...pinned, key };
  next();
}

export async function storeRpcResponse(
  proxyRes: IncomingMessage,
  data: Buffer,
  req: Request
) {
  const pending = req._cache;
  if (!pending) return data;

  // A result this large can never pass set()'s MAX_VALUE_SIZE check (the envelope
  // only adds a little overhead around `result`), so skip the parse and the
  // string copy it would otherwise pay for nothing.
  if (data.length > MAX_VALUE_SIZE) return data;

  let payload: unknown;
  try {
    payload = JSON.parse(data.toString());
  } catch {
    return data;
  }
  if (!isRecord(payload)) return data;

  const { error, result } = payload;
  if (error == null && typeof result === 'string') {
    // Confirming against the chain head and storing happen off the response path:
    // headOf is bounded only by REQUEST_TIMEOUT and must not hold up a result the
    // client already has.
    lastConfirmation = confirmAndStore(req._node, pending, result).catch(err =>
      console.log('[withRpcCache] confirm failed', err)
    );
  }

  return data;
}

async function confirmAndStore(node: Node, pending: Pending, result: string) {
  const needed = pending.block + CONFIRMATIONS;
  const head = await headOf(node, pending.family, needed);
  if (head !== null && head >= needed) set(pending.key, result);
}

let lastConfirmation: Promise<void> = Promise.resolve();

// Test-only hook: resolves once the most recently started background
// confirm-and-store has settled.
export function whenConfirmed(): Promise<void> {
  return lastConfirmation;
}
