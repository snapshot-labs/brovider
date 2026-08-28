import { NextFunction, Request, Response } from 'express';
import measureRpcCache, { reset } from './measureRpcCache';
import { rpcCacheKeyRepeatCount, rpcRequestCount, rpcResponseSizeBytes } from '../helpers/metrics';
import { fetchWithKeepAlive } from '../helpers/utils';

jest.mock('../helpers/utils', () => ({
  ...jest.requireActual('../helpers/utils'),
  fetchWithKeepAlive: jest.fn()
}));

const mockFetchWithKeepAlive = jest.mocked(fetchWithKeepAlive);

function response(body: string, ok = true) {
  return { ok, text: async () => body } as any;
}

function call(method: string, params: unknown, network = '1') {
  const next = jest.fn();
  const req = {
    body: { jsonrpc: '2.0', id: 1, method, params },
    _node: { url: 'https://upstream.example', network, headers: {} }
  } as unknown as Request;
  const res = {
    json: jest.fn(),
    send: jest.fn(),
    status: jest.fn(),
    setHeader: jest.fn()
  } as unknown as Response;

  measureRpcCache(req, res, next as NextFunction);

  expect(next).toHaveBeenCalledTimes(1);
  expect(res.json).not.toHaveBeenCalled();
  expect(res.send).not.toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalled();
  expect(res.setHeader).not.toHaveBeenCalled();
}

async function repeatCounts() {
  return (await rpcCacheKeyRepeatCount.get()).values
    .filter(v => v.value > 0)
    .map(({ labels, value }) => ({ ...labels, value }));
}

async function sizeValues() {
  return (await rpcResponseSizeBytes.get()).values;
}

function sizeSum(values: Awaited<ReturnType<typeof sizeValues>>, rpcMethod: string) {
  return (
    values.find(v => v.metricName?.endsWith('_sum') && v.labels.rpc_method === rpcMethod)?.value ??
    0
  );
}

function sizeCount(values: Awaited<ReturnType<typeof sizeValues>>, rpcMethod: string) {
  return (
    values.find(v => v.metricName?.endsWith('_count') && v.labels.rpc_method === rpcMethod)
      ?.value ?? 0
  );
}

async function requestCountFor(network: string, rpcMethod: string) {
  const metric = await rpcRequestCount.get();
  return metric.values.find(
    v =>
      v.labels.network === network &&
      v.labels.client === 'measure-rpc-cache' &&
      v.labels.rpc_method === rpcMethod
  )?.value;
}

beforeEach(() => {
  jest.clearAllMocks();
  rpcCacheKeyRepeatCount.reset();
  rpcResponseSizeBytes.reset();
  rpcRequestCount.reset();
  reset();
  mockFetchWithKeepAlive.mockResolvedValue(response('{"jsonrpc":"2.0","id":1,"result":"0x1"}'));
});

describe('measureRpcCache', () => {
  it('always calls next synchronously, whether or not the method is measured', () => {
    call('eth_call', [{ to: '0x1' }, '0x10']);
    call('eth_getBlockByNumber', ['0x10', false]);
  });

  describe('key repeat rate', () => {
    it('counts a first-seen key as a MISS on both windows, and a repeat as a HIT', async () => {
      call('eth_getBlockByNumber', ['0x10', false]);
      call('eth_getBlockByNumber', ['0x10', false]);

      expect(await repeatCounts()).toEqual(
        expect.arrayContaining([
          {
            rpc_method: 'eth_getBlockByNumber',
            pinned: 'pinned',
            window: 'short',
            status: 'MISS',
            value: 1
          },
          {
            rpc_method: 'eth_getBlockByNumber',
            pinned: 'pinned',
            window: 'short',
            status: 'HIT',
            value: 1
          },
          {
            rpc_method: 'eth_getBlockByNumber',
            pinned: 'pinned',
            window: 'long',
            status: 'MISS',
            value: 1
          },
          {
            rpc_method: 'eth_getBlockByNumber',
            pinned: 'pinned',
            window: 'long',
            status: 'HIT',
            value: 1
          }
        ])
      );
    });

    it('does not count a request for an unmeasured method', async () => {
      call('eth_call', [{ to: '0x1' }, '0x10']);
      call('eth_chainId', []);

      expect(await repeatCounts()).toEqual([]);
      expect(mockFetchWithKeepAlive).not.toHaveBeenCalled();
    });

    it('treats a different network as a different key', async () => {
      call('eth_getBlockByNumber', ['0x10', false], '1');
      call('eth_getBlockByNumber', ['0x10', false], '10');

      const counts = await repeatCounts();
      expect(counts.filter(c => c.status === 'HIT')).toEqual([]);
    });

    it('forgets a key once reset, so it counts as a fresh MISS', async () => {
      call('eth_getBlockByNumber', ['0x10', false]);
      reset();
      rpcCacheKeyRepeatCount.reset();
      call('eth_getBlockByNumber', ['0x10', false]);

      expect(await repeatCounts()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ window: 'short', status: 'MISS', value: 1 })
        ])
      );
      expect((await repeatCounts()).some(c => c.status === 'HIT')).toBe(false);
    });

    it('evicts only the oldest key once the short window exceeds its 500-key bound', async () => {
      for (let i = 0; i < 501; i++) {
        call('eth_getBlockReceipts', [`0x${i.toString(16)}`]);
      }

      rpcCacheKeyRepeatCount.reset();
      call('eth_getBlockReceipts', ['0x1']);
      let counts = await repeatCounts();
      expect(counts).toEqual(
        expect.arrayContaining([expect.objectContaining({ window: 'short', status: 'HIT' })])
      );

      rpcCacheKeyRepeatCount.reset();
      call('eth_getBlockReceipts', ['0x0']);
      counts = await repeatCounts();
      expect(counts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ window: 'short', status: 'MISS' }),
          expect.objectContaining({ window: 'long', status: 'HIT' })
        ])
      );
    });

    it("keeps a quiet method's key alive while a different method churns past the window bound", async () => {
      call('eth_getTransactionReceipt', ['0xquiet']);

      for (let i = 0; i < 600; i++) {
        call('eth_getBlockReceipts', [`0x${i.toString(16)}`]);
      }

      rpcCacheKeyRepeatCount.reset();
      call('eth_getTransactionReceipt', ['0xquiet']);

      expect(await repeatCounts()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rpc_method: 'eth_getTransactionReceipt',
            window: 'short',
            status: 'HIT'
          })
        ])
      );
    });
  });

  describe('block-pin classification', () => {
    it.each([
      ['eth_getBlockByNumber', ['0x10', false], 'pinned'],
      ['eth_getBlockByNumber', ['latest', false], 'unpinned'],
      ['eth_getBlockByNumber', [undefined, false], 'unpinned'],
      ['eth_getBlockReceipts', ['0x10'], 'pinned'],
      ['eth_getBlockReceipts', ['pending'], 'unpinned'],
      ['eth_getTransactionReceipt', ['0xabc'], 'pinned'],
      ['eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x10' }], 'pinned'],
      ['eth_getLogs', [{ blockHash: '0xabc' }], 'pinned'],
      ['eth_getLogs', [{ fromBlock: '0x1', toBlock: 'latest' }], 'unpinned'],
      ['eth_getLogs', [{}], 'unpinned'],
      ['starknet_call', [{}, { block_number: 10 }], 'pinned'],
      ['starknet_call', [{}, 'latest'], 'unpinned'],
      ['starknet_call', { request: {}, block_id: { block_number: 10 } }, 'pinned'],
      ['starknet_call', { request: {}, block_id: 'latest' }, 'unpinned'],
      ['starknet_getStorageAt', ['0xc', '0xk', { block_hash: '0xabc' }], 'pinned'],
      ['starknet_getStorageAt', ['0xc', '0xk', 'pending'], 'unpinned'],
      [
        'starknet_getStorageAt',
        { contract_address: '0xc', key: '0xk', block_id: { block_hash: '0xabc' } },
        'pinned'
      ],
      [
        'starknet_getStorageAt',
        { contract_address: '0xc', key: '0xk', block_id: 'pending' },
        'unpinned'
      ],
      ['starknet_getClassAt', [{ block_number: 5 }, '0xc'], 'pinned'],
      ['starknet_getClassAt', { block_id: { block_number: 5 }, contract_address: '0xc' }, 'pinned'],
      ['starknet_getClassAt', { block_id: 'pending', contract_address: '0xc' }, 'unpinned'],
      [
        'starknet_getEvents',
        [{ from_block: { block_number: 1 }, to_block: { block_number: 10 } }],
        'pinned'
      ],
      [
        'starknet_getEvents',
        [{ from_block: 'latest', to_block: { block_number: 10 } }],
        'unpinned'
      ],
      [
        'starknet_getEvents',
        { filter: { from_block: { block_number: 1 }, to_block: { block_number: 10 } } },
        'pinned'
      ],
      ['starknet_getEvents', { filter: { from_block: 'latest', to_block: 'latest' } }, 'unpinned'],
      ['starknet_getTransactionReceipt', ['0xabc'], 'pinned']
    ])('labels %s%p as %s', async (method, params, expected) => {
      call(method as string, params);

      const counts = await repeatCounts();
      expect(counts.every(c => c.pinned === expected)).toBe(true);
      expect(counts.length).toBeGreaterThan(0);
    });
  });

  describe('response size sampling', () => {
    it('samples one in fifty identical requests rather than every one', async () => {
      for (let i = 0; i < 49; i++) {
        call('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x1' }]);
      }
      expect(mockFetchWithKeepAlive).not.toHaveBeenCalled();

      call('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x1' }]);
      await new Promise(process.nextTick);

      expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(1);
      expect(sizeCount(await sizeValues(), 'eth_getLogs')).toBe(1);
    });

    it('records the exact decoded byte length, not a placeholder', async () => {
      const body = `{"jsonrpc":"2.0","id":1,"result":"${'a'.repeat(1234)}"}`;
      mockFetchWithKeepAlive.mockResolvedValue(response(body));

      for (let i = 0; i < 50; i++) {
        call('eth_getBlockReceipts', ['0x1']);
      }
      await new Promise(process.nextTick);

      expect(sizeSum(await sizeValues(), 'eth_getBlockReceipts')).toBe(Buffer.byteLength(body));
    });

    it('does not observe a sample whose upstream response is a JSON-RPC error', async () => {
      mockFetchWithKeepAlive.mockResolvedValue(
        response('{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"nope"}}')
      );

      for (let i = 0; i < 50; i++) {
        call('eth_getBlockReceipts', ['0x1']);
      }
      await new Promise(process.nextTick);

      expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(1);
      expect(sizeCount(await sizeValues(), 'eth_getBlockReceipts')).toBe(0);
    });

    it('does not observe a sample whose result is null', async () => {
      mockFetchWithKeepAlive.mockResolvedValue(response('{"jsonrpc":"2.0","id":1,"result":null}'));

      for (let i = 0; i < 50; i++) {
        call('eth_getTransactionReceipt', ['0xpending']);
      }
      await new Promise(process.nextTick);

      expect(sizeCount(await sizeValues(), 'eth_getTransactionReceipt')).toBe(0);
    });

    it('does not observe a sample from a non-2xx upstream response', async () => {
      mockFetchWithKeepAlive.mockResolvedValue(response('rate limited', false));

      for (let i = 0; i < 50; i++) {
        call('eth_getBlockReceipts', ['0x1']);
      }
      await new Promise(process.nextTick);

      expect(sizeCount(await sizeValues(), 'eth_getBlockReceipts')).toBe(0);
    });

    it('counts its own sampling call in rpc_request_count under a distinct client', async () => {
      for (let i = 0; i < 50; i++) {
        call('eth_getBlockReceipts', ['0x1']);
      }
      await new Promise(process.nextTick);

      expect(await requestCountFor('1', 'eth_getBlockReceipts')).toBe(1);
    });

    it('samples per method+network, so round-robining across networks cannot starve one of them', async () => {
      for (let i = 0; i < 25; i++) {
        call('eth_getBlockReceipts', ['0x1'], 'A');
        call('eth_getBlockReceipts', ['0x1'], 'B');
      }
      expect(mockFetchWithKeepAlive).not.toHaveBeenCalled();

      for (let i = 0; i < 25; i++) {
        call('eth_getBlockReceipts', ['0x1'], 'A');
      }
      await new Promise(process.nextTick);

      expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(1);
      expect(await requestCountFor('A', 'eth_getBlockReceipts')).toBe(1);
      expect(await requestCountFor('B', 'eth_getBlockReceipts')).toBeUndefined();
    });

    it('swallows a failed sample instead of throwing', async () => {
      mockFetchWithKeepAlive.mockRejectedValue(new Error('upstream down'));

      expect(() => {
        for (let i = 0; i < 50; i++) {
          call('eth_getBlockReceipts', ['0x1']);
        }
      }).not.toThrow();

      await new Promise(process.nextTick);
      expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(1);
    });
  });
});
