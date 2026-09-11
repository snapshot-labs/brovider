import { IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import { brotliCompressSync, gzipSync } from 'zlib';
import express from 'express';
import request from 'supertest';
import {
  rpcCacheBytes,
  rpcCacheEntries,
  rpcCacheHeadLookupCount,
  rpcCacheHitCount,
  rpcRequestCount
} from '../../src/helpers/metrics';
import { nodes, stop } from '../../src/helpers/nodes';
import withRpcCache, {
  whenConfirmed
} from '../../src/middlewares/withRpcCache';
import mountMiddleware from '../../src/mountMiddleware';
import rpc from '../../src/rpc';

const HEAD = 20000000;
const DEEP_BLOCK = '0x1000000';
const SHALLOW_BLOCK = `0x${HEAD.toString(16)}`;
const ADDRESS = '0x0000000000000000000000000000000000000001';

type Canned = {
  status?: number;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
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
  let blockNumberDelay: number | undefined;
  let received: IncomingHttpHeaders = {};
  const responses = new Map<string, Canned>();

  const call = (data: string, block: string, id: number = 1) => ({
    jsonrpc: '2.0',
    method: 'eth_call',
    params: [{ to: ADDRESS, data }, block],
    id
  });

  const countOf = (method: string) => calls.filter(m => m === method).length;

  async function statuses() {
    const metric = await rpcCacheHitCount.get();
    // rpc_cache_hit_count now also carries network/rpc_method labels, so a
    // status can appear across several value entries; sum them per status.
    return metric.values.reduce<Record<string, number>>((sums, v) => {
      const status = v.labels.status as string;
      sums[status] = (sums[status] ?? 0) + v.value;
      return sums;
    }, {});
  }

  async function requestCountTotal() {
    const metric = await rpcRequestCount.get();
    return metric.values.reduce((sum, v) => sum + v.value, 0);
  }

  async function cacheSize() {
    const [entries, bytes] = await Promise.all([
      rpcCacheEntries.get(),
      rpcCacheBytes.get()
    ]);
    return { entries: entries.values[0].value, bytes: bytes.values[0].value };
  }

  async function headLookups(network: string) {
    const metric = await rpcCacheHeadLookupCount.get();
    return metric.values.find(v => v.labels.network === network)?.value ?? 0;
  }

  async function closeServer(server: Server): Promise<void> {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }

  async function startLowHeadServer(): Promise<Server> {
    const lowHeadApp = express();
    lowHeadApp.use(express.json());
    lowHeadApp.post('/', (req, res) => {
      const { method, id } = req.body;
      calls.push(method);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: method === 'eth_blockNumber' ? '0x3e8' : '0xbad' // head 1000
      });
    });
    return new Promise(resolve => {
      const s = lowHeadApp.listen(0, '127.0.0.1', () => resolve(s));
    });
  }

  beforeAll(async () => {
    stop();
    app = express();
    mountMiddleware(app);
    app.use('/', rpc);

    const upstreamApp = express();
    upstreamApp.use(express.json({ limit: '4mb' }));
    upstreamApp.post('/', async (req, res) => {
      const { method, params, id } = req.body;
      calls.push(method);
      received = req.headers;
      const delay =
        method === 'eth_blockNumber' && blockNumberDelay !== undefined
          ? blockNumberDelay
          : upstreamDelay;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));

      if (!Object.hasOwn(req.body, 'id')) {
        return res.status(204).end();
      }

      if (method === 'eth_blockNumber') {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: `0x${HEAD.toString(16)}`
        });
      }

      const canned = responses.get(params?.[0]?.data ?? params?.[0]);
      if (canned) {
        if (canned.headers) res.set(canned.headers);
        res.status(canned.status ?? 200);
        if (canned.raw !== undefined) return res.send(canned.raw);
        return res.json({ jsonrpc: '2.0', id, ...canned.body });
      }

      answers += 1;
      const payload = { jsonrpc: '2.0', id, result: `0x${answers}` };
      if (req.headers['accept-encoding']?.includes('br')) {
        res.set('content-encoding', 'br').type('json');
        return res.send(brotliCompressSync(JSON.stringify(payload)));
      }
      if (req.headers['accept-encoding']?.includes('gzip')) {
        res.set('content-encoding', 'gzip').type('json');
        return res.send(gzipSync(JSON.stringify(payload)));
      }
      return res.json(payload);
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
    blockNumberDelay = undefined;
  });

  afterAll(async () => {
    for (const [network, url] of Object.entries(originalNodes)) {
      if (url === undefined) delete configuredNodes[network];
      else configuredNodes[network] = url;
    }
    await closeServer(upstream);
  });

  it('should look the head up once per network for the whole ttl window', async () => {
    upstreamDelay = 0;

    await request(app).post('/1').send(call('0xa001', DEEP_BLOCK));
    await whenConfirmed();
    await request(app).post('/1').send(call('0xa002', DEEP_BLOCK));
    await whenConfirmed();
    await request(app).post('/1').send(call('0xa003', DEEP_BLOCK));
    await whenConfirmed();

    expect(countOf('eth_call')).toBe(3);
    expect(countOf('eth_blockNumber')).toBe(1);
  });

  it('should not look the head up again for a block already final under the last known head', async () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 20e3);
    try {
      await request(app).post('/1').send(call('0xa004', DEEP_BLOCK));

      expect(countOf('eth_call')).toBe(1);
      expect(countOf('eth_blockNumber')).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('should refresh the head for a block within the confirmation depth once the window has passed', async () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 40e3);
    try {
      await request(app).post('/1').send(call('0xa005', SHALLOW_BLOCK));
      await whenConfirmed();

      expect(countOf('eth_blockNumber')).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('should count each head lookup by network', async () => {
    const before = await headLookups('10');

    await request(app).post('/10').send(call('0xa006', DEEP_BLOCK));
    await whenConfirmed();

    expect(countOf('eth_blockNumber')).toBe(1);
    expect((await headLookups('10')) - before).toBe(1);
  });

  it('answers the leader before the background head confirmation, not after it', async () => {
    upstreamDelay = 0;
    blockNumberDelay = 500;
    // Past the head TTL, forcing headOf to actually fetch instead of reusing a cached head.
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60e3);

    try {
      const start = performance.now();
      const response = await request(app)
        .post('/1')
        .send(call('0xa007', SHALLOW_BLOCK));
      const elapsed = performance.now() - start;

      expect(response.body.result).toBeDefined();
      expect(elapsed).toBeLessThan(blockNumberDelay);
    } finally {
      spy.mockRestore();
      await whenConfirmed();
    }
  });

  it('should recheck the head once the network is repointed at a different node', async () => {
    configuredNodes['11'] = upstreamUrl;
    try {
      // Warm the head against the original provider (head 20,000,000): any
      // block <= head - CONFIRMATIONS is now final without rechecking.
      await request(app).post('/11').send(call('0xa020', DEEP_BLOCK));
      await whenConfirmed();
      expect(countOf('eth_blockNumber')).toBe(1);

      // Repoint the network at a different node — a DB failover, or by
      // mistake onto a different chain — whose real head is far lower.
      const lowHeadServer = await startLowHeadServer();

      try {
        const { port } = lowHeadServer.address() as AddressInfo;
        configuredNodes['11'] = `http://127.0.0.1:${port}`;

        // Block 900 is only 100 below the new provider's real head (1000):
        // not final under CONFIRMATIONS=128. The old provider's stale head
        // (20,000,000) would have certified it as final had it never been
        // rechecked.
        const body = call('0xa021', '0x384', 1);
        calls = [];
        await request(app).post('/11').send(body);
        await whenConfirmed();
        expect(countOf('eth_blockNumber')).toBe(1);

        calls = [];
        await request(app)
          .post('/11')
          .send({ ...body, id: 2 });
        expect(countOf('eth_call')).toBe(1); // never cached
      } finally {
        await closeServer(lowHeadServer);
      }
    } finally {
      delete configuredNodes['11'];
    }
  });

  it('should not certify a repointed node against a head lookup still in flight for the old one', async () => {
    upstreamDelay = 0;
    blockNumberDelay = 600;
    configuredNodes['12'] = upstreamUrl;

    const lowHeadServer = await startLowHeadServer();

    try {
      // The old provider's head lookup (head 20,000,000) is still in flight
      // when the network moves to a node whose head is 1000.
      await request(app).post('/12').send(call('0xa030', '0x384'));
      const { port } = lowHeadServer.address() as AddressInfo;
      configuredNodes['12'] = `http://127.0.0.1:${port}`;

      calls = [];
      const body = call('0xa031', '0x384');
      await request(app).post('/12').send(body);
      await whenConfirmed();
      await request(app)
        .post('/12')
        .send({ ...body, id: 2 });

      // The new node was asked for its own head, and block 900 (100 below
      // it) was never stored.
      expect(countOf('eth_blockNumber')).toBe(1);
      expect(countOf('eth_call')).toBe(2);
    } finally {
      delete configuredNodes['12'];
      await closeServer(lowHeadServer);
    }
  });

  it.each([
    {
      method: 'eth_call',
      tag: '0xbb01',
      params: (t: string) => [{ to: ADDRESS, data: t }, DEEP_BLOCK]
    },
    {
      method: 'eth_getBalance',
      tag: '0xbb02',
      params: (t: string) => [t, DEEP_BLOCK]
    },
    {
      method: 'eth_getCode',
      tag: '0xbb03',
      params: (t: string) => [t, DEEP_BLOCK]
    },
    {
      method: 'eth_getStorageAt',
      tag: '0xbb04',
      params: (t: string) => [t, '0x0', DEEP_BLOCK]
    }
  ])(
    'should serve a repeated $method from cache',
    async ({ method, tag, params }) => {
      const body = { jsonrpc: '2.0', method, params: params(tag), id: 1 };

      const first = await request(app).post('/1').send(body);
      expect(countOf(method)).toBe(1);
      await whenConfirmed();

      calls = [];
      const second = await request(app)
        .post('/1')
        .send({ ...body, id: 2 });

      expect(countOf(method)).toBe(0);
      expect(second.body).toEqual({
        jsonrpc: '2.0',
        id: 2,
        result: first.body.result
      });
    }
  );

  it("should take eth_getStorageAt's block from the third parameter, not the second", async () => {
    const body = {
      jsonrpc: '2.0',
      method: 'eth_getStorageAt',
      params: ['0xbb05', SHALLOW_BLOCK, DEEP_BLOCK],
      id: 1
    };

    await request(app).post('/1').send(body);
    await whenConfirmed();

    calls = [];
    await request(app)
      .post('/1')
      .send({ ...body, id: 2 });

    expect(countOf('eth_getStorageAt')).toBe(0);
  });

  it('should never cache a latest read', async () => {
    await Promise.all([
      request(app)
        .post('/1')
        .send(call('0xaa03', 'latest', 1)),
      request(app)
        .post('/1')
        .send(call('0xaa03', 'latest', 2))
    ]);
    expect(countOf('eth_call')).toBe(2);

    await request(app)
      .post('/1')
      .send(call('0xaa03', 'latest', 3));
    expect(countOf('eth_call')).toBe(3);
  });

  it('should not store a read above the confirmation depth', async () => {
    const first = await request(app)
      .post('/1')
      .send(call('0xaa04', SHALLOW_BLOCK, 1));
    await whenConfirmed();

    calls = [];
    const second = await request(app)
      .post('/1')
      .send(call('0xaa04', SHALLOW_BLOCK, 2));

    expect(countOf('eth_call')).toBe(1);
    expect(second.body.result).not.toBe(first.body.result);
  });

  it('should proxy concurrent identical reads separately until the first one is stored', async () => {
    // In-flight deduplication is deferred to a follow-up: until the first answer is
    // confirmed and stored, identical reads in flight each reach the upstream.
    const before = await statuses();

    const [first, second] = await Promise.all([
      request(app)
        .post('/1')
        .send(call('0xaa01', DEEP_BLOCK, 11)),
      request(app)
        .post('/1')
        .send(call('0xaa01', DEEP_BLOCK, 22))
    ]);
    await whenConfirmed();

    expect(countOf('eth_call')).toBe(2);
    expect(first.body.id).toBe(11);
    expect(second.body.id).toBe(22);
    expect((await statuses()).MISS - (before.MISS || 0)).toBe(2);

    calls = [];
    const third = await request(app)
      .post('/1')
      .send(call('0xaa01', DEEP_BLOCK, 33));
    expect(countOf('eth_call')).toBe(0);
    expect(third.body.result).toBe(first.body.result);

    const metric = await rpcCacheHitCount.get();
    const methods = metric.values
      .filter(v => v.labels.status === 'MISS')
      .map(v => v.labels.rpc_method);
    expect(methods).toContain('eth_call');
  });

  it.each([
    {
      label: 'a result next to an error',
      data: '0xaa06',
      body: { result: '0xf', error: {} }
    },
    { label: 'a null result', data: '0xaa07', body: { result: null } },
    {
      label: 'a result above the value size cap',
      data: '0xaa08',
      body: { result: '0x'.padEnd(200e3, 'f') }
    }
  ])('should not cache $label', async ({ data, body }) => {
    responses.set(data, { body });

    const first = await request(app)
      .post('/1')
      .send(call(data, DEEP_BLOCK, 1));
    const second = await request(app)
      .post('/1')
      .send(call(data, DEEP_BLOCK, 2));

    expect(countOf('eth_call')).toBe(2);
    expect(first.body.id).toBe(1);
    expect(second.body.id).toBe(2);
  });

  it('should forward an over-cap body unchanged without parsing it', async () => {
    const data = '0xaa12';
    const big = '0x'.padEnd(200e3, 'f');
    responses.set(data, { body: { result: big } });

    const parseSpy = jest.spyOn(JSON, 'parse');
    let response;
    try {
      response = await request(app)
        .post('/1')
        .send(call(data, DEEP_BLOCK, 1));
    } finally {
      parseSpy.mockRestore();
    }

    // The over-cap body is forwarded unchanged...
    expect(response.body.result).toBe(big);
    // ...but never handed to JSON.parse: only the small client request body
    // (parsed by express.json() upstream of the cache) may have gone through.
    const parsedTheBigBody = parseSpy.mock.calls.some(
      ([text]) => typeof text === 'string' && text.length > 150e3
    );
    expect(parsedTheBigBody).toBe(false);
  });

  it('should forward the upstream status and response headers on a miss', async () => {
    responses.set('0xcc01', {
      status: 429,
      headers: { 'retry-after': '30', 'x-ratelimit-remaining': '0' },
      body: { error: { code: 429, message: 'slow down' } }
    });

    const response = await request(app)
      .post('/1')
      .send(call('0xcc01', DEEP_BLOCK));

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

    const response = await request(app)
      .post('/1')
      .send(call('0xcc06', DEEP_BLOCK));

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
    expect(response.text).toBe('rate limited');
  });

  it('should forward the client request headers to the upstream', async () => {
    await request(app)
      .post('/1')
      .set('x-client-tag', 'score-api')
      .send(call('0xcc07', DEEP_BLOCK));

    expect(received['x-client-tag']).toBe('score-api');
  });

  it('should bypass the cache for a notification, even once the value is cached', async () => {
    const body = {
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: ['0xcc08', DEEP_BLOCK],
      id: 1
    };

    await request(app).post('/1').send(body);
    expect(countOf('eth_getCode')).toBe(1);

    calls = [];
    const response = await request(app)
      .post('/1')
      .send({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: ['0xcc08', DEEP_BLOCK]
      });

    expect(response.status).toBe(204);
    expect(countOf('eth_getCode')).toBe(1);
  });

  it('should cache a read even when the client accepts brotli', async () => {
    const body = {
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: ['0xcc0b', DEEP_BLOCK],
      id: 1
    };

    const miss = await request(app)
      .post('/1')
      .set('accept-encoding', 'br')
      .send(body);
    await whenConfirmed();
    const hit = await request(app)
      .post('/1')
      .set('accept-encoding', 'br')
      .send(body);

    expect(countOf('eth_getCode')).toBe(1);
    expect(hit.body.result).toBe(miss.body.result);
  });

  it('should request gzip from the upstream when the client accepts it, and forward a correct response', async () => {
    const body = {
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: ['0xcc0c', DEEP_BLOCK],
      id: 1
    };

    const miss = await request(app)
      .post('/1')
      .set('accept-encoding', 'gzip')
      .send(body);
    const hit = await request(app)
      .post('/1')
      .set('accept-encoding', 'gzip')
      .send(body);

    expect(received['accept-encoding']).toBe('gzip');
    expect(countOf('eth_getCode')).toBe(1);
    expect(miss.body.result).toBe(hit.body.result);
  });

  it('should answer every concurrent read of an unreachable node with an error', async () => {
    configuredNodes['10'] = 'http://127.0.0.1:1';

    const [first, second] = await Promise.all([
      request(app)
        .post('/10')
        .send(call('0xcc02', DEEP_BLOCK, 7)),
      request(app)
        .post('/10')
        .send(call('0xcc02', DEEP_BLOCK, 8))
    ]);

    expect(first.status).toBeGreaterThanOrEqual(500);
    expect(second.status).toBeGreaterThanOrEqual(500);

    configuredNodes['10'] = upstreamUrl;
  });

  it('should keep the node url out of the logs when the upstream fails', async () => {
    configuredNodes['10'] = 'http://127.0.0.1:1/?apikey=SUPERSECRETKEY';
    const logged: string[] = [];
    const record = (...args: unknown[]) => {
      logged.push(
        args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
      );
    };
    const spies = [
      jest.spyOn(console, 'log').mockImplementation(record),
      jest.spyOn(console, 'error').mockImplementation(record)
    ];

    try {
      await request(app).post('/10').send(call('0xcc09', DEEP_BLOCK));
    } finally {
      spies.forEach(spy => spy.mockRestore());
      configuredNodes['10'] = upstreamUrl;
    }

    expect(logged.join('\n')).not.toContain('SUPERSECRETKEY');
  });

  it('should keep the node url out of the logs when the head lookup fails', async () => {
    const failingHead = express();
    failingHead.use(express.json());
    failingHead.post('/', (req, res) => {
      const { method, id } = req.body;
      calls.push(method);
      if (method === 'eth_blockNumber') return req.socket.destroy();
      return res.json({ jsonrpc: '2.0', id, result: '0x1' });
    });
    const server: Server = await new Promise(resolve => {
      const s = failingHead.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    configuredNodes['13'] = `http://127.0.0.1:${port}/?apikey=SUPERSECRETKEY`;

    const logged: string[] = [];
    const record = (...args: unknown[]) => {
      logged.push(
        args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
      );
    };
    const spies = [
      jest.spyOn(console, 'log').mockImplementation(record),
      jest.spyOn(console, 'error').mockImplementation(record)
    ];

    try {
      await request(app).post('/13').send(call('0xcc10', DEEP_BLOCK));
      await whenConfirmed();
    } finally {
      spies.forEach(spy => spy.mockRestore());
      delete configuredNodes['13'];
      await closeServer(server);
    }

    expect(countOf('eth_blockNumber')).toBe(1);
    expect(logged.join('\n')).toContain('head lookup failed');
    expect(logged.join('\n')).not.toContain('SUPERSECRETKEY');
  });

  it('should not store a result that is not a string', async () => {
    responses.set('0xcc0a', { body: { result: [['a'], ['b']] } });

    await request(app)
      .post('/1')
      .send(call('0xcc0a', DEEP_BLOCK, 1));
    await request(app)
      .post('/1')
      .send(call('0xcc0a', DEEP_BLOCK, 2));

    expect(countOf('eth_call')).toBe(2);
  });

  it('should answer with jsonrpc 2.0 on both a miss and a hit', async () => {
    const body = {
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: ['0xcc03', DEEP_BLOCK],
      id: 1
    };

    const miss = await request(app).post('/1').send(body);
    await whenConfirmed();
    const hit = await request(app).post('/1').send(body);

    expect(countOf('eth_getCode')).toBe(1);
    expect(miss.body.jsonrpc).toBe('2.0');
    expect(hit.body.jsonrpc).toBe('2.0');
  });

  it('should not serve an entry cached against a different node url', async () => {
    const body = {
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: ['0xcc04', DEEP_BLOCK],
      id: 1
    };

    await request(app).post('/1').send(body);
    await whenConfirmed();
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
    const body = {
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: ['0xcc05', DEEP_BLOCK],
      id: 1
    };

    await request(app).post('/1').send(body);
    await whenConfirmed();
    calls = [];
    await request(app).post('/1').send(body);
    expect(countOf('eth_getCode')).toBe(0);

    const spy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 2 * 3600e3);
    try {
      calls = [];
      await request(app).post('/1').send(body);
      expect(countOf('eth_getCode')).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('should report the number of entries and bytes it holds', async () => {
    const before = await cacheSize();

    await request(app).post('/1').send(call('0xaa11', DEEP_BLOCK));
    await whenConfirmed();
    await request(app).post('/1').send(call('0xaa11', DEEP_BLOCK));

    const after = await cacheSize();
    expect(after.entries - before.entries).toBe(1);
    expect(after.bytes).toBeGreaterThan(before.bytes);
  });

  it('should evict the least recently used entries once the byte budget is exceeded', async () => {
    upstreamDelay = 0;
    const big = '0x'.padEnd(90e3, 'f');
    const tagOf = (i: number) => `0xdd${i.toString(16).padStart(4, '0')}`;
    const send = (tag: string) =>
      request(app)
        .post('/1')
        .send({
          jsonrpc: '2.0',
          method: 'eth_getCode',
          params: [tag, DEEP_BLOCK],
          id: 1
        });

    const fill = async (from: number, to: number) => {
      for (let i = from; i < to; i++) {
        responses.set(tagOf(i), { body: { result: big } });
        await send(tagOf(i));
        await whenConfirmed();
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
    await whenConfirmed();
    await request(app).post('/1').send(call('0xaa09', DEEP_BLOCK));
    await request(app)
      .post('/1')
      .send({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });

    const after = await statuses();

    expect((after.MISS || 0) - (before.MISS || 0)).toBe(1);
    expect((after.HIT || 0) - (before.HIT || 0)).toBe(1);
    expect((after.BYPASS || 0) - (before.BYPASS || 0)).toBe(1);
  });

  it('should count a miss and a bypass but not a hit toward rpc_request_count', async () => {
    const before = await requestCountTotal();

    await request(app).post('/1').send(call('0xaa10', DEEP_BLOCK));
    await whenConfirmed();
    await request(app).post('/1').send(call('0xaa10', DEEP_BLOCK));
    await request(app)
      .post('/1')
      .send({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });

    const after = await requestCountTotal();

    expect(after - before).toBe(2);
  });

  describe('withRpcCache given a JSON-RPC batch', () => {
    let batchApp: express.Application;

    beforeAll(() => {
      batchApp = express();
      batchApp.use(express.json());
      batchApp.use((req, _res, next) => {
        req._node = { url: upstreamUrl, path: '/', network: '1', headers: {} };
        next();
      });
      batchApp.use(withRpcCache);
      batchApp.use((_req, res) => res.status(200).json({ reachedNext: true }));
    });

    it('passes an array body to next() rather than treating it as cacheable', async () => {
      const response = await request(batchApp)
        .post('/')
        .send([
          {
            jsonrpc: '2.0',
            method: 'eth_call',
            params: [{ to: ADDRESS }, DEEP_BLOCK],
            id: 1
          }
        ]);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ reachedNext: true });
    });
  });
});
