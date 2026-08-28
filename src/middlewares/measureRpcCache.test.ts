import { NextFunction, Request, Response } from 'express';
import { rpcCacheKeyRepeatCount, rpcResponseSizeBytes } from '../helpers/metrics';
import { fetchWithKeepAlive } from '../helpers/utils';

jest.mock('../helpers/utils', () => ({
  ...jest.requireActual('../helpers/utils'),
  fetchWithKeepAlive: jest.fn()
}));

const mockFetchWithKeepAlive = jest.mocked(fetchWithKeepAlive);

let measureRpcCache: (req: Request, res: Response, next: NextFunction) => void;
let reset: () => void;

function response(body: string) {
  return { text: async () => body } as any;
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

async function sizeSamples() {
  const metric = await rpcResponseSizeBytes.get();
  return metric.values.filter(v => v.metricName?.endsWith('_sum') && v.value > 0);
}

beforeAll(async () => {
  ({ default: measureRpcCache, reset } = await import('./measureRpcCache'));
});

beforeEach(() => {
  jest.clearAllMocks();
  rpcCacheKeyRepeatCount.reset();
  rpcResponseSizeBytes.reset();
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
      ['starknet_getStorageAt', ['0xc', '0xk', { block_hash: '0xabc' }], 'pinned'],
      ['starknet_getStorageAt', ['0xc', '0xk', 'pending'], 'unpinned'],
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
      ['starknet_getTransactionReceipt', ['0xabc'], 'pinned']
    ])('labels %s%p as %s', async (method, params, expected) => {
      call(method as string, params);

      const counts = await repeatCounts();
      expect(counts.every(c => c.pinned === expected)).toBe(true);
      expect(counts.length).toBeGreaterThan(0);
    });
  });

  describe('response size sampling', () => {
    it('samples one in twenty identical requests rather than every one', async () => {
      for (let i = 0; i < 19; i++) {
        call('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x1' }]);
      }
      expect(mockFetchWithKeepAlive).not.toHaveBeenCalled();

      call('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x1' }]);
      await new Promise(process.nextTick);

      expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(1);
      expect(await sizeSamples()).toEqual([
        expect.objectContaining({
          labels: { rpc_method: 'eth_getLogs', pinned: 'pinned' }
        })
      ]);
    });

    it('swallows a failed sample instead of throwing', async () => {
      mockFetchWithKeepAlive.mockRejectedValue(new Error('upstream down'));

      expect(() => {
        for (let i = 0; i < 20; i++) {
          call('eth_getBlockReceipts', ['0x1']);
        }
      }).not.toThrow();

      await new Promise(process.nextTick);
      expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(1);
    });
  });
});
