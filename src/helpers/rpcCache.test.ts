import {
  config,
  get,
  pin,
  readConfig,
  resetCache,
  set,
  stats,
  tooRecent,
  updateHead
} from './rpcCache';

const HASH = `0x${'ab'.repeat(32)}`;

describe('pin', () => {
  it.each([
    ['eth_getLogs', [{ blockHash: HASH }], undefined],
    ['eth_getBlockByHash', [HASH, false], undefined],
    ['eth_getBlockByNumber', ['0x10', false], 16],
    ['eth_getBlockReceipts', ['0x10'], 16],
    [
      'eth_getLogs',
      [{ fromBlock: '0x1', toBlock: '0x20', address: '0xa' }],
      32
    ],
    ['eth_call', [{ to: '0xa', data: '0x' }, '0x10'], 16],
    ['eth_call', [{ to: '0xa', data: '0x' }, { blockHash: HASH }], undefined],
    ['eth_getBalance', ['0xa', '0x10'], 16],
    ['eth_getCode', ['0xa', '0x10'], 16],
    ['eth_getTransactionCount', ['0xa', '0x10'], 16],
    ['eth_getStorageAt', ['0xa', '0x0', '0x10'], 16]
  ])('pins %s %j', (method, params, block) => {
    expect(pin('1', method, params)).toEqual({
      key: expect.stringMatching(/^[0-9a-f]{64}$/),
      block
    });
  });

  it.each([
    ['eth_blockNumber', []],
    ['eth_getBlockByNumber', ['latest', false]],
    ['eth_getBlockByNumber', [16, false]],
    ['eth_getLogs', [{ fromBlock: '0x1' }]],
    ['eth_getLogs', [{ fromBlock: '0x1', toBlock: 'latest' }]],
    ['eth_getLogs', [{ blockHash: '0x12' }]],
    ['eth_getLogs', [null]],
    ['eth_call', [{ to: '0xa', data: '0x' }, 'latest']],
    ['eth_call', [{ to: '0xa', data: '0x' }]],
    ['eth_getStorageAt', ['0xa', '0x0', 'pending']],
    ['eth_getTransactionReceipt', [HASH]],
    ['eth_sendRawTransaction', ['0x10']],
    ['eth_getBlockByNumber', undefined]
  ])('skips %s %j', (method, params) => {
    expect(pin('1', method, params)).toBeNull();
  });

  it('skips a block hash that must stay canonical', () => {
    const tx = { to: '0xa', data: '0x' };
    expect(
      pin('1', 'eth_call', [tx, { blockHash: HASH, requireCanonical: true }])
    ).toBeNull();
    expect(
      pin('1', 'eth_call', [tx, { blockHash: HASH, requireCanonical: false }])
    ).not.toBeNull();
  });

  it('separates networks and params', () => {
    const a = pin('1', 'eth_getBlockByNumber', ['0x10', false])!.key;
    expect(pin('10', 'eth_getBlockByNumber', ['0x10', false])!.key).not.toBe(a);
    expect(pin('1', 'eth_getBlockByNumber', ['0x10', true])!.key).not.toBe(a);
    expect(pin('1', 'eth_getBlockByNumber', ['0x10', false])!.key).toBe(a);
  });
});

describe('LRU store', () => {
  const maxBytes = config.maxBytes;

  beforeEach(resetCache);
  afterAll(() => {
    config.maxBytes = maxBytes;
  });

  it('evicts the least recently used entry when over budget', () => {
    const size = stats;
    set('a', Buffer.alloc(100));
    const perEntry = size().bytes;
    config.maxBytes = perEntry * 2;

    set('b', Buffer.alloc(100));
    get('a'); // a is now the most recent
    set('c', Buffer.alloc(100));

    expect(get('a')).toBeDefined();
    expect(get('b')).toBeUndefined();
    expect(get('c')).toBeDefined();
    expect(stats()).toEqual({ bytes: perEntry * 2, entries: 2 });
  });

  it('replaces an entry without counting it twice', () => {
    config.maxBytes = maxBytes;
    set('a', Buffer.alloc(100));
    const once = stats().bytes;
    set('a', Buffer.alloc(100));

    expect(stats()).toEqual({ bytes: once, entries: 1 });
  });
});

describe('tooRecent', () => {
  beforeEach(resetCache);

  it('needs a known head and enough depth', () => {
    expect(tooRecent('1', 10)).toBe('head_unknown');

    updateHead('1', 100);
    updateHead('1', 90); // the head never goes back
    expect(tooRecent('1', 100 - config.depth + 1)).toBe('too_recent');
    expect(tooRecent('1', 100 - config.depth)).toBeNull();
  });

  it('asks for more depth on Polygon', () => {
    updateHead('137', 1000);
    expect(tooRecent('137', 1000 - config.depth)).toBe('too_recent');
  });

  it('never asks Polygon for less depth than the configured one', () => {
    const depth = config.depth;
    config.depth = 500;
    updateHead('137', 1000);
    expect(tooRecent('137', 1000 - 256)).toBe('too_recent');
    config.depth = depth;
  });
});

describe('readConfig', () => {
  it('keeps the cache off unless the mode is exactly shadow or on', () => {
    expect(readConfig({}).mode).toBe('off');
    expect(readConfig({ RPC_CACHE: 'ON' }).mode).toBe('off');
    expect(readConfig({ RPC_CACHE: 'true' }).mode).toBe('off');
    expect(readConfig({ RPC_CACHE: 'shadow' }).mode).toBe('shadow');
    expect(readConfig({ RPC_CACHE: 'on' }).mode).toBe('on');
  });

  it('falls back to the defaults on invalid numbers', () => {
    for (const value of ['abc', '-1', '', 'Infinity', '1.5e400']) {
      const read = readConfig({ RPC_CACHE_MB: value, RPC_CACHE_DEPTH: value });
      expect(read.maxBytes).toBe(512 * 1024 * 1024);
      expect(read.depth).toBe(32);
    }
    expect(readConfig({ RPC_CACHE_MB: '0' }).maxBytes).toBe(512 * 1024 * 1024);
    expect(readConfig({ RPC_CACHE_MB: '64' }).maxBytes).toBe(64 * 1024 * 1024);
    expect(readConfig({ RPC_CACHE_DEPTH: '0' }).depth).toBe(0);
    expect(readConfig({ RPC_CACHE_DEPTH: '64' }).depth).toBe(64);
  });
});
