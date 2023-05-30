import fetch from 'cross-fetch';
import redis from './helpers/redis';
import rpcs from './rpcs.json';
import { createHash } from 'crypto';

const ANKR_KEY = process.env.ANKR_KEY;
export const RPC_LIST_WITH_KEYS = {};
for (const networkId in rpcs) {
  const rpcList = rpcs[networkId].map(rpc => {
    if (typeof rpc === 'string' && rpc.startsWith('https://rpc.ankr.com/')) {
      return `${rpc}/${ANKR_KEY}`;
    }
    return rpc;
  });

  RPC_LIST_WITH_KEYS[networkId] = rpcList;
}

export function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

export async function getBlock(key, network, body) {
  if (redis) {
    const cached = await redis.get(key);
    if (cached) return { error: null, result: JSON.parse(cached) };
  }
  body = JSON.stringify(body);
  const node = RPC_LIST_WITH_KEYS[network] ? RPC_LIST_WITH_KEYS[network][0] : null;
  const nodeURL = typeof node === 'object' ? node.url : node;
  const authHeader =
    typeof node === 'object' && node.user && node.password
      ? 'Basic ' + Buffer.from(`${node.user}:${node.password}`).toString('base64')
      : '';

  const response = await fetch(nodeURL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authHeader
    },
    body
  });

  const { error, result } = await response.json();
  if (redis && !error && result) {
    redis.set(key, JSON.stringify(result)).catch(console.log);
  }
  return { error, result };
}
