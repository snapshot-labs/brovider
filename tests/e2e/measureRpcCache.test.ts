import { Server } from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import {
  rpcCacheKeyRepeatCount,
  rpcRequestCount,
  rpcResponseSizeBytes
} from '../../src/helpers/metrics';
import { nodes, stop } from '../../src/helpers/nodes';
import { reset as resetRpcCacheMeasurement } from '../../src/middlewares/measureRpcCache';
import rpc from '../../src/rpc';

describe('measureRpcCache E2E Tests', () => {
  let app: express.Application;
  let upstream: Server;
  let upstreamRequests: string[] = [];
  let configuredNodes: Record<string, string>;
  let originalNode: string | undefined;

  beforeAll(async () => {
    stop();
    app = express();
    app.use(express.json());
    app.use('/', rpc);

    const upstreamApp = express();
    upstreamApp.use(express.json());
    upstreamApp.post('/', (req, res) => {
      upstreamRequests.push(req.body.method);
      res.json({ jsonrpc: '2.0', id: req.body.id, result: `0x${upstreamRequests.length}` });
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
    upstreamRequests = [];
    rpcCacheKeyRepeatCount.reset();
    rpcResponseSizeBytes.reset();
    rpcRequestCount.reset();
    resetRpcCacheMeasurement();
  });

  afterAll(async () => {
    if (originalNode === undefined) delete configuredNodes['1'];
    else configuredNodes['1'] = originalNode;
    await new Promise<void>((resolve, reject) => {
      upstream.close(error => (error ? reject(error) : resolve()));
    });
  });

  const getBlock = (block: string, id = 1) => ({
    jsonrpc: '2.0',
    method: 'eth_getBlockByNumber',
    params: [block, false],
    id
  });

  it('serves the real proxied response unchanged for a measured, block-pinned request', async () => {
    const response = await request(app).post('/1').send(getBlock('0x10')).expect(200);

    expect(response.body).toEqual({ jsonrpc: '2.0', id: 1, result: '0x1' });
    expect(upstreamRequests).toEqual(['eth_getBlockByNumber']);
  });

  it('counts a repeated key as a HIT on both windows without touching the served response', async () => {
    const first = await request(app).post('/1').send(getBlock('0x20', 1)).expect(200);
    const second = await request(app).post('/1').send(getBlock('0x20', 2)).expect(200);

    expect(first.body.result).toBe('0x1');
    expect(second.body.result).toBe('0x2');

    const counts = (await rpcCacheKeyRepeatCount.get()).values
      .filter(v => v.value > 0)
      .map(({ labels, value }) => ({ ...labels, value }));

    expect(counts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ window: 'short', status: 'MISS', value: 1 }),
        expect.objectContaining({ window: 'short', status: 'HIT', value: 1 }),
        expect.objectContaining({ window: 'long', status: 'MISS', value: 1 }),
        expect.objectContaining({ window: 'long', status: 'HIT', value: 1 })
      ])
    );
  });

  it('samples a decoded response size once per fifty identical requests, as an extra upstream call the client never sees, and it is counted separately', async () => {
    for (let i = 0; i < 50; i++) {
      const response = await request(app).post('/1').send(getBlock('0x30', i)).expect(200);
      expect(response.body.id).toBe(i);
    }

    await new Promise(process.nextTick);

    expect(upstreamRequests.length).toBe(51);
    const sizeMetric = await rpcResponseSizeBytes.get();
    const observed = sizeMetric.values.some(
      v =>
        v.metricName?.endsWith('_count') &&
        v.labels.rpc_method === 'eth_getBlockByNumber' &&
        v.value === 1
    );
    expect(observed).toBe(true);

    const requestCount = (await rpcRequestCount.get()).values.find(
      v => v.labels.client === 'measure-rpc-cache' && v.labels.rpc_method === 'eth_getBlockByNumber'
    );
    expect(requestCount?.value).toBe(1);
  });

  it('classifies a named-object Starknet call the same way as its positional equivalent', async () => {
    const named = {
      jsonrpc: '2.0',
      method: 'starknet_call',
      params: { request: { contract_address: '0xc' }, block_id: { block_number: 5 } },
      id: 1
    };
    await request(app).post('/1').send(named).expect(200);

    const counts = (await rpcCacheKeyRepeatCount.get()).values
      .filter(v => v.value > 0)
      .map(({ labels, value }) => ({ ...labels, value }));
    expect(counts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rpc_method: 'starknet_call', pinned: 'pinned' })
      ])
    );
  });

  it('does not measure a method outside the configured set, such as eth_call', async () => {
    await request(app)
      .post('/1')
      .send({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: '0x1' }, '0x10'], id: 1 })
      .expect(200);

    const counts = (await rpcCacheKeyRepeatCount.get()).values.filter(v => v.value > 0);
    expect(counts).toEqual([]);
  });
});
