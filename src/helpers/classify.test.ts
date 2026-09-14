import { isLiveRequest } from './classify';

const HEAD = 20000;

describe('isLiveRequest', () => {
  it.each([
    ['eth_blockNumber', []],
    ['eth_getBlockByNumber', ['latest', false]],
    ['eth_getBlockByNumber', ['0x4e20', false]],
    ['eth_getBlockByNumber', ['0x4e21', false]],
    ['eth_getBlockByNumber', ['0x4a38', false]],
    ['eth_getBlockByNumber', ['0x5208', false]],
    ['eth_getLogs', [{ blockHash: '0xabc' }]],
    ['eth_getLogs', [{ fromBlock: '0x4e1e', toBlock: '0x4e20' }]],
    ['eth_getLogs', [{ fromBlock: '0x4e1e' }]]
  ])('routes %s %j to public nodes', (method, params) => {
    expect(isLiveRequest({ method, params }, HEAD)).toBe(true);
  });

  it.each([
    ['eth_getBlockByNumber', ['0x4a37', false]],
    ['eth_getBlockByNumber', ['0x5209', false]],
    ['eth_getLogs', [{ fromBlock: '0x5209', toBlock: '0x5300' }]],
    ['eth_getBlockByNumber', [1234, false]],
    ['eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x4e20' }]],
    ['eth_getLogs', [{ fromBlock: '0x1' }]],
    ['eth_getLogs', []],
    ['eth_call', [{}, 'latest']],
    ['eth_getBalance', ['0xabc', 'latest']]
  ])('keeps %s %j on the main node', (method, params) => {
    expect(isLiveRequest({ method, params }, HEAD)).toBe(false);
  });
});
