import http from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import fetch from 'node-fetch';
import withRpcCache from './withRpcCache';
import {
  rpcCacheCount,
  rpcCacheMismatchCount,
  rpcCacheStoreCount
} from '../helpers/metrics';
import { config, get, pin, resetCache } from '../helpers/rpcCache';

const HASH = `0x${'ab'.repeat(32)}`;
const LOG = { address: '0xa', data: '0x01', blockHash: HASH };

type Answer = {
  status?: number;
  result?: unknown;
  error?: unknown;
  delay?: number;
  hang?: boolean;
  abort?: boolean;
};

let answer: (body: any) => Answer = () => ({ result: [LOG] });
let calls: any[] = [];
let nodeUrl: string;
let appUrl: string;
const servers: http.Server[] = [];

function listen(server: http.Server): Promise<string> {
  servers.push(server);
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    )
  );
}

beforeAll(async () => {
  nodeUrl = await listen(
    http.createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => (raw += chunk));
      req.on('end', () => {
        const body = JSON.parse(raw);
        calls.push({ body, headers: req.headers });
        const {
          status = 200,
          result,
          error,
          delay = 0,
          hang,
          abort
        } = answer(body);
        if (hang) return;
        if (abort) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.write('{"jsonrpc":"2.0","id":1,"result":[');
          return setTimeout(() => res.socket?.destroy(), 20);
        }
        setTimeout(() => {
          res.writeHead(status, {
            'content-type': 'application/json',
            'x-node': 'upstream'
          });
          res.end(
            JSON.stringify({ jsonrpc: '2.0', id: body.id, result, error })
          );
        }, delay);
      });
    })
  );

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req._node = {
      url: req.headers['x-test-node'] || `${nodeUrl}/?secret=s`,
      network: '8453',
      headers: { 'x-node-key': 'k' }
    };
    next();
  });
  app.use(withRpcCache);
  app.use((_req, res) => {
    res.status(599).json({ fallback: true });
  });
  appUrl = await listen(http.createServer(app));
});

afterAll(() => servers.forEach(server => server.close()));

beforeEach(() => {
  resetCache();
  rpcCacheCount.reset();
  rpcCacheStoreCount.reset();
  rpcCacheMismatchCount.reset();
  config.mode = 'on';
  config.timeout = 2000;
  answer = () => ({ result: [LOG] });
  calls = [];
});

async function rpc(
  method: string,
  params: unknown[],
  id: unknown = 1,
  headers: Record<string, string> = {}
) {
  const res = await fetch(appUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
  return {
    status: res.status,
    cache: res.headers.get('x-brovider-cache'),
    body: await res.json().catch(() => null)
  };
}

async function count(counter: typeof rpcCacheCount, result: string) {
  const { values } = await counter.get();
  return values
    .filter(v => v.labels.result === result)
    .reduce((sum, v) => sum + v.value, 0);
}

// Storing happens right after the response, give it a tick
const settled = () => new Promise(resolve => setTimeout(resolve, 20));

describe('withRpcCache', () => {
  it('passes straight to the proxy when off', async () => {
    config.mode = 'off';

    expect(await rpc('eth_getLogs', [{ blockHash: HASH }])).toMatchObject({
      status: 599
    });
    expect(calls).toHaveLength(0);
  });

  it('leaves requests that are not pinned to the proxy', async () => {
    expect(await rpc('eth_blockNumber', [])).toMatchObject({ status: 599 });
    expect(await count(rpcCacheCount, 'unpinned')).toBe(1);
  });

  it('streams the node answer, then serves repeats from memory', async () => {
    const first = await rpc('eth_getLogs', [{ blockHash: HASH }], 1);
    await settled();
    const second = await rpc('eth_getLogs', [{ blockHash: HASH }], 'abc');

    expect(first).toEqual({
      status: 200,
      cache: null,
      body: { jsonrpc: '2.0', id: 1, result: [LOG] }
    });
    expect(second).toEqual({
      status: 200,
      cache: 'HIT',
      body: { jsonrpc: '2.0', id: 'abc', result: [LOG] }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['x-node-key']).toBe('k');
    expect(await count(rpcCacheCount, 'hit')).toBe(1);
    expect(await count(rpcCacheStoreCount, 'stored')).toBe(1);
  });

  it('keeps the node headers on a miss', async () => {
    const res = await fetch(appUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [{ blockHash: HASH }]
      })
    });

    expect(res.headers.get('x-node')).toBe('upstream');
  });

  it('does not store empty logs, errors or null', async () => {
    for (const reply of [
      { result: [] },
      { error: { code: -32000, message: 'boom' } },
      { result: null }
    ]) {
      answer = () => reply;
      await rpc('eth_getLogs', [{ blockHash: HASH }]);
      await settled();
      await rpc('eth_getLogs', [{ blockHash: HASH }]);
      await settled();
    }

    expect(calls).toHaveLength(6);
    expect(await count(rpcCacheStoreCount, 'empty')).toBe(2);
    expect(await count(rpcCacheStoreCount, 'error')).toBe(2);
    expect(await count(rpcCacheStoreCount, 'null')).toBe(2);
  });

  it('passes a 429 through and does not store it', async () => {
    answer = () => ({ status: 429, error: { message: 'rate limited' } });

    expect(await rpc('eth_getLogs', [{ blockHash: HASH }])).toMatchObject({
      status: 429
    });
    await settled();
    expect(await count(rpcCacheStoreCount, 'status')).toBe(1);
  });

  it('only stores blocks deep enough behind the head', async () => {
    answer = body => ({ result: { number: body.params[0], hash: HASH } });
    const head = `0x${(100).toString(16)}`;
    const deep = `0x${(100 - config.depth).toString(16)}`;
    const recent = `0x${(100 - config.depth + 1).toString(16)}`;

    await rpc('eth_getBlockByNumber', [head, false]);
    await settled();
    expect(await count(rpcCacheStoreCount, 'too_recent')).toBe(1);

    for (const block of [deep, recent]) {
      await rpc('eth_getBlockByNumber', [block, false]);
      await settled();
    }
    expect((await rpc('eth_getBlockByNumber', [deep, false])).cache).toBe(
      'HIT'
    );
    expect((await rpc('eth_getBlockByNumber', [recent, false])).cache).toBe(
      null
    );
  });

  it('does not trust a block number before any head is known', async () => {
    await rpc('eth_call', [{ to: '0xa', data: '0x' }, '0x10']);
    await settled();

    expect(await count(rpcCacheStoreCount, 'head_unknown')).toBe(1);
  });

  it('makes one node call for identical requests in flight', async () => {
    answer = () => ({ result: [LOG], delay: 100 });

    const [a, b] = await Promise.all([
      rpc('eth_getLogs', [{ blockHash: HASH }], 1),
      rpc('eth_getLogs', [{ blockHash: HASH }], 2)
    ]);

    expect(a.body).toEqual({ jsonrpc: '2.0', id: 1, result: [LOG] });
    expect(b.body).toEqual({ jsonrpc: '2.0', id: 2, result: [LOG] });
    expect(calls).toHaveLength(1);
    expect(await count(rpcCacheCount, 'shared')).toBe(1);
  });

  it('in shadow mode always asks the node and reports mismatches', async () => {
    config.mode = 'shadow';
    await rpc('eth_getLogs', [{ blockHash: HASH }]);
    await settled();
    answer = () => ({ result: [{ ...LOG, data: '0x02' }] });
    const second = await rpc('eth_getLogs', [{ blockHash: HASH }]);
    await settled();

    expect(second.cache).toBeNull();
    expect(second.body.result[0].data).toBe('0x02');
    expect(calls).toHaveLength(2);
    expect(await count(rpcCacheCount, 'hit')).toBe(1);
    const { values } = await rpcCacheMismatchCount.get();
    expect(values[0].value).toBe(1);
  });

  it('answers 504 like the proxy when the node times out', async () => {
    config.timeout = 100;
    answer = () => ({ hang: true });

    expect(await rpc('eth_getLogs', [{ blockHash: HASH }])).toMatchObject({
      status: 504
    });
  });

  it('times out followers together with the request they share', async () => {
    config.timeout = 150;
    answer = () => ({ hang: true });

    const started = Date.now();
    const statuses = await Promise.all([
      rpc('eth_getLogs', [{ blockHash: HASH }], 1),
      rpc('eth_getLogs', [{ blockHash: HASH }], 2)
    ]);

    expect(statuses.map(r => r.status)).toEqual([504, 504]);
    expect(Date.now() - started).toBeLessThan(280);
    expect(calls).toHaveLength(1);
  });

  it('recovers right away when the node drops the connection mid-answer', async () => {
    answer = () => ({ abort: true });
    await rpc('eth_getLogs', [{ blockHash: HASH }]).catch(() => null);

    answer = () => ({ result: [LOG] });
    const started = Date.now();
    const next = await rpc('eth_getLogs', [{ blockHash: HASH }]);

    expect(next.status).toBe(200);
    expect(next.body.result).toEqual([LOG]);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('stores answers outside the shared buffer pool', async () => {
    answer = () => ({ result: `0x${'1'.repeat(64)}` });
    await rpc('eth_getBalance', ['0xa', { blockHash: HASH }]);
    await settled();

    const stored = get(
      pin('8453', 'eth_getBalance', ['0xa', { blockHash: HASH }])!.key
    )!;
    expect(stored.buffer.byteLength).toBe(stored.length);
  });

  it('echoes hostile ids safely on a hit', async () => {
    await rpc('eth_getLogs', [{ blockHash: HASH }]);
    await settled();

    for (const id of [
      '"},"result":"pwned',
      'line\u2028break\u2029\n\r\u0000',
      { nested: ['x', 1, null] },
      0,
      null
    ]) {
      const hit = await rpc('eth_getLogs', [{ blockHash: HASH }], id);
      expect(hit.cache).toBe('HIT');
      expect(hit.body).toEqual({ jsonrpc: '2.0', id, result: [LOG] });
    }
  });

  it('hands over to the proxy when the node cannot be reached', async () => {
    const res = await rpc('eth_getLogs', [{ blockHash: HASH }], 1, {
      'x-test-node': 'http://127.0.0.1:1/'
    });

    expect(res.status).toBe(599);
  });
});
