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

describe('RPC cache E2E Tests', () => {
  let app: express.Application;
  let upstream: Server;
  let configuredNodes: Record<string, string>;
  let originalNode: string | undefined;
  let calls: string[] = [];
  let answers = 0;
  const responses = new Map<string, Record<string, any>>();

  const call = (data: string, block: string, id: number = 1) => ({
    jsonrpc: '2.0',
    method: 'eth_call',
    params: [{ to: '0x0000000000000000000000000000000000000001', data }, block],
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
    upstreamApp.use(express.json());
    upstreamApp.post('/', async (req, res) => {
      const { method, params, id } = req.body;
      calls.push(method);
      await new Promise(resolve => setTimeout(resolve, 100));

      if (method === 'eth_blockNumber') {
        return res.json({ jsonrpc: '2.0', id, result: `0x${HEAD.toString(16)}` });
      }

      const canned = responses.get(params?.[0]?.data);
      if (canned) return res.json({ jsonrpc: '2.0', id, ...canned });

      answers += 1;
      return res.json({ jsonrpc: '2.0', id, result: `0x${answers}` });
    });
    upstream = await new Promise(resolve => {
      const server = upstreamApp.listen(0, '127.0.0.1', () => resolve(server));
    });

    const { port } = upstream.address() as AddressInfo;
    configuredNodes = nodes as Record<string, string>;
    originalNode = configuredNodes['1'];
    configuredNodes['1'] = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    calls = [];
  });

  afterAll(async () => {
    if (originalNode === undefined) delete configuredNodes['1'];
    else configuredNodes['1'] = originalNode;
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      upstream.close(error => (error ? reject(error) : resolve()));
    });
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

  it('should serve a repeated block-pinned read from cache without an upstream request', async () => {
    const first = await request(app).post('/1').send(call('0xaa02', DEEP_BLOCK));
    expect(countOf('eth_call')).toBe(1);

    calls = [];
    const second = await request(app).post('/1').send(call('0xaa02', DEEP_BLOCK, 2));

    expect(countOf('eth_call')).toBe(0);
    expect(second.body).toEqual({ jsonrpc: '2.0', id: 2, result: first.body.result });
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
    { label: 'an upstream error', data: '0xaa05', canned: { error: { code: -32000 } } },
    { label: 'a result next to an error', data: '0xaa06', canned: { result: '0xf', error: {} } },
    { label: 'a null result', data: '0xaa07', canned: { result: null } },
    {
      label: 'a result above the value size cap',
      data: '0xaa08',
      canned: { result: '0x'.padEnd(200e3, 'f') }
    }
  ])('should not cache $label', async ({ data, canned }) => {
    responses.set(data, canned);

    const first = await request(app).post('/1').send(call(data, DEEP_BLOCK, 1));
    const second = await request(app).post('/1').send(call(data, DEEP_BLOCK, 2));

    expect(countOf('eth_call')).toBe(2);
    expect(first.body.id).toBe(1);
    expect(second.body.id).toBe(2);
  });

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
