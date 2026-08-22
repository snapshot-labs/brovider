import { Server } from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { rpcCacheCount } from '../../src/helpers/metrics';
import { nodes, stop } from '../../src/helpers/nodes';
import rpc from '../../src/rpc';

const HEAD = 20000000;
const DEEP_BLOCK = '0x1000000';
const SHALLOW_BLOCK = `0x${HEAD.toString(16)}`;
const ADDRESS = '0x0000000000000000000000000000000000000001';

type Canned = {
  status?: number;
  headers?: Record<string, string>;
  body?: Record<string, any>;
  raw?: string;
};

describe('RPC cache E2E Tests', () => {
  let app: express.Application;
  let upstream: Server;
  let upstreamUrl: string;
  let configuredNodes: Record<string, string>;
  let originalNodes: Record<string, string | undefined>;
  let calls: string[] = [];
  let answers = 0;
  let upstreamDelay = 100;
  let received: Record<string, any> = {};
  const responses = new Map<string, Canned>();

  const call = (data: string, block: string, id: number = 1) => ({
    jsonrpc: '2.0',
    method: 'eth_call',
    params: [{ to: ADDRESS, data }, block],
    id
  });

  const countOf = (method: string) => calls.filter(m => m === method).length;

  async function statuses() {
    const metric = await rpcCacheCount.get();
    return Object.fromEntries(metric.values.map(v => [v.labels.status as string, v.value]));
  }

  beforeAll(async () => {
    stop();
    app = express();
    app.use(express.json());
    app.use('/', rpc);

    const upstreamApp = express();
    upstreamApp.use(express.json({ limit: '4mb' }));
    upstreamApp.post('/', async (req, res) => {
      const { method, params, id } = req.body;
      calls.push(method);
      received = req.headers;
      if (upstreamDelay) await new Promise(resolve => setTimeout(resolve, upstreamDelay));

      if (method === 'eth_blockNumber') {
        return res.json({ jsonrpc: '2.0', id, result: `0x${HEAD.toString(16)}` });
      }

      const canned = responses.get(params?.[0]?.data ?? params?.[0]);
      if (canned) {
        if (canned.headers) res.set(canned.headers);
        res.status(canned.status ?? 200);
        if (canned.raw !== undefined) return res.send(canned.raw);
        return res.json({ jsonrpc: '2.0', id, ...canned.body });
      }

      answers += 1;
      return res.json({ jsonrpc: '2.0', id, result: `0x${answers}` });
    });
    upstream = await new Promise(resolve => {
      const server = upstreamApp.listen(0, '127.0.0.1', () => resolve(server));
    });

    const { port } = upstream.address() as AddressInfo;
    upstreamUrl = `http://127.0.0.1:${port}`;
    configuredNodes = nodes as Record<string, string>;
    originalNodes = { '1': configuredNodes['1'], '10': configuredNodes['10'] };
    configuredNodes['1'] = upstreamUrl;
    configuredNodes['10'] = upstreamUrl;
  });

  beforeEach(() => {
    calls = [];
    upstreamDelay = 100;
  });

  afterAll(async () => {
    for (const [network, url] of Object.entries(originalNodes)) {
      if (url === undefined) delete configuredNodes[network];
      else configuredNodes[network] = url;
    }
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      upstream.close(error => (error ? reject(error) : resolve()));
    });
  });

  it('should look the head up once per network for the whole ttl window', async () => {
    upstreamDelay = 0;

    await request(app).post('/1').send(call('0xa001', DEEP_BLOCK));
    await request(app).post('/1').send(call('0xa002', DEEP_BLOCK));
    await request(app).post('/1').send(call('0xa003', DEEP_BLOCK));

    expect(countOf('eth_call')).toBe(3);
    expect(countOf('eth_blockNumber')).toBe(1);
  });

  it('should answer two concurrent block-pinned reads with a single upstream request', async () => {
    const [first, second] = await Promise.all([
      request(app).post('/1').send(call('0xaa01', DEEP_BLOCK, 11)),
      request(app).post('/1').send(call('0xaa01', DEEP_BLOCK, 22))
    ]);

    expect(countOf('eth_call')).toBe(1);
    expect(first.body.result).toBe(second.body.result);
    expect(first.body.id).toBe(11);
    expect(second.body.id).toBe(22);
  });

  it.each([
    {
      method: 'eth_call',
      tag: '0xbb01',
      params: (t: string) => [{ to: ADDRESS, data: t }, DEEP_BLOCK]
    },
    { method: 'eth_getBalance', tag: '0xbb02', params: (t: string) => [t, DEEP_BLOCK] },
    { method: 'eth_getCode', tag: '0xbb03', params: (t: string) => [t, DEEP_BLOCK] },
    { method: 'eth_getStorageAt', tag: '0xbb04', params: (t: string) => [t, '0x0', DEEP_BLOCK] }
  ])('should serve a repeated $method from cache', async ({ method, tag, params }) => {
    const body = { jsonrpc: '2.0', method, params: params(tag), id: 1 };

    const first = await request(app).post('/1').send(body);
    expect(countOf(method)).toBe(1);

    calls = [];
    const second = await request(app)
      .post('/1')
      .send({ ...body, id: 2 });

    expect(countOf(method)).toBe(0);
    expect(second.body).toEqual({ jsonrpc: '2.0', id: 2, result: first.body.result });
  });

  it("should take eth_getStorageAt's block from the third parameter, not the second", async () => {
    const body = {
      jsonrpc: '2.0',
      method: 'eth_getStorageAt',
      params: ['0xbb05', SHALLOW_BLOCK, DEEP_BLOCK],
      id: 1
    };

    await request(app).post('/1').send(body);

    calls = [];
    await request(app)
      .post('/1')
      .send({ ...body, id: 2 });

    expect(countOf('eth_getStorageAt')).toBe(0);
  });

  it('should never cache or dedupe a latest read', async () => {
    await Promise.all([
      request(app).post('/1').send(call('0xaa03', 'latest', 1)),
      request(app).post('/1').send(call('0xaa03', 'latest', 2))
    ]);
    expect(countOf('eth_call')).toBe(2);

    await request(app).post('/1').send(call('0xaa03', 'latest', 3));
    expect(countOf('eth_call')).toBe(3);
  });

  it('should dedupe but not store a read above the confirmation depth', async () => {
    const [first, second] = await Promise.all([
      request(app).post('/1').send(call('0xaa04', SHALLOW_BLOCK, 1)),
      request(app).post('/1').send(call('0xaa04', SHALLOW_BLOCK, 2))
    ]);
    expect(countOf('eth_call')).toBe(1);
    expect(first.body.result).toBe(second.body.result);

    calls = [];
    const third = await request(app).post('/1').send(call('0xaa04', SHALLOW_BLOCK, 3));

    expect(countOf('eth_call')).toBe(1);
    expect(third.body.result).not.toBe(first.body.result);
  });

  it.each([
    { label: 'a result next to an error', data: '0xaa06', body: { result: '0xf', error: {} } },
    { label: 'a null result', data: '0xaa07', body: { result: null } },
    {
      label: 'a result above the value size cap',
      data: '0xaa08',
      body: { result: '0x'.padEnd(200e3, 'f') }
    }
  ])('should not cache $label', async ({ data, body }) => {
    responses.set(data, { body });

    const first = await request(app).post('/1').send(call(data, DEEP_BLOCK, 1));
    const second = await request(app).post('/1').send(call(data, DEEP_BLOCK, 2));

    expect(countOf('eth_call')).toBe(2);
    expect(first.body.id).toBe(1);
    expect(second.body.id).toBe(2);
  });

  it('should forward the upstream status and response headers on a miss', async () => {
    responses.set('0xcc01', {
      status: 429,
      headers: { 'retry-after': '30', 'x-ratelimit-remaining': '0' },
      body: { error: { code: 429, message: 'slow down' } }
    });

    const response = await request(app).post('/1').send(call('0xcc01', DEEP_BLOCK));

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('should forward a non-JSON upstream body with its status and headers', async () => {
    responses.set('0xcc06', {
      status: 429,
      headers: { 'retry-after': '30', 'content-type': 'text/plain' },
      raw: 'rate limited'
    });

    const response = await request(app).post('/1').send(call('0xcc06', DEEP_BLOCK));

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
    expect(response.text).toBe('rate limited');
  });

  it('should forward the client request headers to the upstream', async () => {
    await request(app).post('/1').set('x-client-tag', 'score-api').send(call('0xcc07', DEEP_BLOCK));

    expect(received['x-client-tag']).toBe('score-api');
  });

  it('should answer a request with no id with a null id', async () => {
    const response = await request(app)
      .post('/1')
      .send({ jsonrpc: '2.0', method: 'eth_getCode', params: ['0xcc08', DEEP_BLOCK] });

    expect(response.body.id).toBeNull();
  });

  it('should answer a failed upstream once, without a second attempt through the proxy', async () => {
    configuredNodes['10'] = 'http://127.0.0.1:1';

    const response = await request(app).post('/10').send(call('0xcc02', DEEP_BLOCK, 7));

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32603, message: 'Upstream request failed' }
    });

    configuredNodes['10'] = upstreamUrl;
  });

  it('should keep the node url out of the logs when the upstream fails', async () => {
    configuredNodes['10'] = 'http://127.0.0.1:1/?apikey=SUPERSECRETKEY';
    const logged: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logged.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });

    try {
      await request(app).post('/10').send(call('0xcc09', DEEP_BLOCK));
    } finally {
      spy.mockRestore();
      configuredNodes['10'] = upstreamUrl;
    }

    expect(logged.join('\n')).not.toContain('SUPERSECRETKEY');
  });

  it('should not store a result that is not a string', async () => {
    responses.set('0xcc0a', { body: { result: [['a'], ['b']] } });

    await request(app).post('/1').send(call('0xcc0a', DEEP_BLOCK, 1));
    await request(app).post('/1').send(call('0xcc0a', DEEP_BLOCK, 2));

    expect(countOf('eth_call')).toBe(2);
  });

  it('should answer with jsonrpc 2.0 on both a miss and a hit', async () => {
    const body = { jsonrpc: '1.0', method: 'eth_getCode', params: ['0xcc03', DEEP_BLOCK], id: 1 };

    const miss = await request(app).post('/1').send(body);
    const hit = await request(app).post('/1').send(body);

    expect(countOf('eth_getCode')).toBe(1);
    expect(miss.body.jsonrpc).toBe('2.0');
    expect(hit.body.jsonrpc).toBe('2.0');
  });

  it('should not serve an entry cached against a different node url', async () => {
    const body = { jsonrpc: '2.0', method: 'eth_getCode', params: ['0xcc04', DEEP_BLOCK], id: 1 };

    await request(app).post('/1').send(body);
    calls = [];
    await request(app).post('/1').send(body);
    expect(countOf('eth_getCode')).toBe(0);

    configuredNodes['1'] = `${upstreamUrl}/?provider=b`;
    calls = [];
    await request(app).post('/1').send(body);
    configuredNodes['1'] = upstreamUrl;

    expect(countOf('eth_getCode')).toBe(1);
  });

  it('should refetch an entry once its ttl has passed', async () => {
    const body = { jsonrpc: '2.0', method: 'eth_getCode', params: ['0xcc05', DEEP_BLOCK], id: 1 };

    await request(app).post('/1').send(body);
    calls = [];
    await request(app).post('/1').send(body);
    expect(countOf('eth_getCode')).toBe(0);

    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 3600e3);
    try {
      calls = [];
      await request(app).post('/1').send(body);
      expect(countOf('eth_getCode')).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('should evict the least recently used entries once the byte budget is exceeded', async () => {
    upstreamDelay = 0;
    const big = '0x'.padEnd(90e3, 'f');
    const tagOf = (i: number) => `0xdd${i.toString(16).padStart(4, '0')}`;
    const send = (tag: string) =>
      request(app)
        .post('/1')
        .send({ jsonrpc: '2.0', method: 'eth_getCode', params: [tag, DEEP_BLOCK], id: 1 });

    const fill = async (from: number, to: number) => {
      for (let i = from; i < to; i++) {
        responses.set(tagOf(i), { body: { result: big } });
        await send(tagOf(i));
      }
    };

    await fill(0, 60);

    calls = [];
    await send(tagOf(0));
    expect(countOf('eth_getCode')).toBe(0);

    await fill(60, 100);

    calls = [];
    await send(tagOf(0));
    expect(countOf('eth_getCode')).toBe(0);

    calls = [];
    await send(tagOf(1));
    expect(countOf('eth_getCode')).toBe(1);

    calls = [];
    await send(tagOf(99));
    expect(countOf('eth_getCode')).toBe(0);
  }, 120e3);

  it('should proxy a method outside the cacheable set untouched', async () => {
    const body = {
      jsonrpc: '2.0',
      method: 'eth_getBlockByNumber',
      params: [DEEP_BLOCK, false],
      id: 1
    };

    await request(app).post('/1').send(body);
    await request(app).post('/1').send(body);

    expect(countOf('eth_getBlockByNumber')).toBe(2);
  });

  it('should count each cache outcome', async () => {
    const before = await statuses();

    await request(app).post('/1').send(call('0xaa09', DEEP_BLOCK));
    await request(app).post('/1').send(call('0xaa09', DEEP_BLOCK));
    await request(app)
      .post('/1')
      .send({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });

    const after = await statuses();

    expect((after.MISS || 0) - (before.MISS || 0)).toBe(1);
    expect((after.HIT || 0) - (before.HIT || 0)).toBe(1);
    expect((after.BYPASS || 0) - (before.BYPASS || 0)).toBe(1);
  });
});
