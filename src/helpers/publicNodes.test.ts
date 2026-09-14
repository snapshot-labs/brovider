import { checkPublicNodes, getHead, markFailed, selectNodes } from './publicNodes';
import { fetchWithKeepAlive } from './utils';

jest.mock('./nodes', () => ({
  publicNodes: { '1': ['https://a', 'https://b'], sn: ['https://c'] },
  run: async () => undefined,
  stop: () => undefined
}));
jest.mock('./utils', () => ({
  ...jest.requireActual('./utils'),
  fetchWithKeepAlive: jest.fn()
}));

const fetchMock = fetchWithKeepAlive as jest.Mock;

type Behaviour = { chainId?: string; head?: number; age?: number; fail?: boolean };
const behaviours: Record<string, Behaviour> = {};

function respond(result: unknown) {
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
}

fetchMock.mockImplementation(async (url: string, options: any) => {
  const { chainId = '0x1', head = 100, age = 0, fail = false } = behaviours[url] ?? {};
  if (fail) throw new Error('down');

  const { method } = JSON.parse(options.body);
  if (method === 'eth_chainId') return respond(chainId);

  const timestamp = Math.floor(Date.now() / 1000) - age;
  return respond({ number: `0x${head.toString(16)}`, timestamp: `0x${timestamp.toString(16)}` });
});

async function runChecks(rounds: number) {
  for (let i = 0; i < rounds; i++) await checkPublicNodes();
}

describe('publicNodes', () => {
  beforeEach(() => {
    for (const key of Object.keys(behaviours)) delete behaviours[key];
  });

  it('needs three passed checks before a node is ready', async () => {
    await runChecks(2);
    expect(selectNodes('1')).toEqual([]);
    expect(getHead('1')).toBe(null);

    await runChecks(1);
    expect(selectNodes('1').sort()).toEqual(['https://a', 'https://b']);
    expect(getHead('1')).toBe(100);
  });

  it('puts the freshest node first and rotates equal ones', async () => {
    behaviours['https://b'] = { head: 90 };
    await runChecks(3);

    expect(selectNodes('1')).toEqual(['https://a', 'https://b']);
    expect(selectNodes('1')).toEqual(['https://a', 'https://b']);
  });

  it('drops lagging, wrong chain and failing nodes', async () => {
    await runChecks(3);
    behaviours['https://a'] = { age: 500 };
    behaviours['https://b'] = { chainId: '0x2' };
    await runChecks(1);

    expect(selectNodes('1')).toEqual([]);
  });

  it('removes a node on markFailed until checks pass again', async () => {
    await runChecks(3);
    markFailed('1', 'https://a');
    expect(selectNodes('1')).toEqual(['https://b']);

    await runChecks(3);
    expect(selectNodes('1').length).toBe(2);
  });

  it('ignores non-evm networks', async () => {
    await runChecks(3);
    expect(selectNodes('sn')).toEqual([]);
  });
});
