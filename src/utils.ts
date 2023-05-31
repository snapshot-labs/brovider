import fetch from 'cross-fetch';
import AwsStorageEngine from './helpers/aws';
import rpcs from './rpcs.json';

const aws = new AwsStorageEngine('blocks');

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

export async function getBlock(key: string, network: string, body: string) {
  const withCache = aws.client;
  if (withCache) {
    const cached = await aws.get(key);
    if (cached) return { error: undefined, result: JSON.parse(cached) };
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
  if (withCache && !error && result) {
    aws.set(key, JSON.stringify(result)).catch(console.log);
  }
  return { error, result };
}
