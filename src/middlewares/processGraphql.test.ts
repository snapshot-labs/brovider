import { NextFunction, Request, Response } from 'express';
import { get, set } from '../helpers/aws';
import { fetchWithKeepAlive } from '../helpers/utils';

jest.mock('../helpers/aws', () => ({
  get: jest.fn(),
  set: jest.fn()
}));

jest.mock('../helpers/utils', () => ({
  ...jest.requireActual('../helpers/utils'),
  fetchWithKeepAlive: jest.fn()
}));

const mockGet = jest.mocked(get);
const mockSet = jest.mocked(set);
const mockFetchWithKeepAlive = jest.mocked(fetchWithKeepAlive);
const cachedResponses = new Map<string, any>();
const upstreamResponse = { data: { items: [] } };
const awsRegion = process.env.AWS_REGION;

let processGraphql: (req: Request, res: Response, next: NextFunction) => Promise<void | Response>;

function response() {
  return {
    ok: true,
    text: async () => JSON.stringify(upstreamResponse)
  } as any;
}

async function execute(query: string, variables: Record<string, unknown> = {}) {
  const json = jest.fn();
  const next = jest.fn();
  const req = {
    body: { query, variables },
    _subgraph_url: { url: 'https://example.com/graphql' }
  } as unknown as Request;
  const res = { json } as unknown as Response;

  await processGraphql(req, res, next as NextFunction);

  expect(next).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledWith(upstreamResponse);
}

async function expectNoPersistentCache(query: string, variables: Record<string, unknown> = {}) {
  await execute(query, variables);
  await execute(query, variables);
  expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(2);
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockSet).not.toHaveBeenCalled();
}

beforeAll(async () => {
  process.env.AWS_REGION = 'test-region';
  processGraphql = (await import('./processGraphql')).default;
});

afterAll(() => {
  if (awsRegion === undefined) {
    delete process.env.AWS_REGION;
  } else {
    process.env.AWS_REGION = awsRegion;
  }
});

beforeEach(() => {
  cachedResponses.clear();
  jest.clearAllMocks();
  mockGet.mockImplementation(async key => cachedResponses.get(key));
  mockSet.mockImplementation(async (key, value) => {
    cachedResponses.set(key, value);
    return {} as any;
  });
  mockFetchWithKeepAlive.mockResolvedValue(response());
});

describe('processGraphql caching', () => {
  it('caches queries pinned to an inline block number or hash', async () => {
    const queries = [
      '{ items(block: { number: 123 }) { id } }',
      '{ items(block: { hash: "0x123" }) { id } }'
    ];

    for (const query of queries) {
      await execute(query);
      await execute(query);
    }

    expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  it('caches queries pinned by block variables', async () => {
    const query = 'query Items($block: Block_height) { items(block: $block) { id } }';
    const variableSets = [{ block: { number: 123 } }, { block: { hash: '0x123' } }];

    for (const variables of variableSets) {
      await execute(query, variables);
      await execute(query, variables);
    }

    expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  it('caches queries pinned by variables inside block objects', async () => {
    const query = 'query Items($number: Int) { items(block: { number: $number }) { id } }';
    const variables = { number: 123 };

    await execute(query, variables);
    await execute(query, variables);

    expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it('bypasses persistent caching when an inline block pin variable is unresolved', async () => {
    const query = `
      query Items($number: Int, $minimum: Int!) {
        items(block: { number: $number, number_gte: $minimum }) { id }
      }
    `;

    await expectNoPersistentCache(query, { minimum: 123 });
  });

  it('ignores inherited names when resolving inline block variables', async () => {
    const query = `
      query Items($toString: Int, $minimum: Int!) {
        items(block: { number: $toString, number_gte: $minimum }) { id }
      }
    `;

    await expectNoPersistentCache(query, { minimum: 123 });
  });

  it('bypasses persistent caching for unpinned block variables', async () => {
    const query = 'query Items($block: Block_height) { items(block: $block) { id } }';
    const variableSets = [
      { block: { number_gte: 123 } },
      { block: { number: null } },
      { block: { hash: null } },
      { block: null },
      {}
    ];

    for (const variables of variableSets) {
      await execute(query, variables);
      await execute(query, variables);
    }

    expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(variableSets.length * 2);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('bypasses persistent caching for block number_gte while deduplicating in-flight requests', async () => {
    const query = '{ items(block: { number_gte: 123 }) { id } }';

    await expectNoPersistentCache(query);

    let resolveFetch: ((value: any) => void) | undefined;
    mockFetchWithKeepAlive.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve;
        })
    );

    const firstRequest = execute(query);
    const secondRequest = execute(query);

    expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(3);
    resolveFetch?.(response());
    await Promise.all([firstRequest, secondRequest]);

    expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(3);
  });

  it('uses an operation definition that follows a fragment definition', async () => {
    const query = `
      fragment ItemFields on Item {
        id
      }
      query Items {
        items(block: { number: 123 }) {
          ...ItemFields
        }
      }
    `;

    await execute(query);
    await execute(query);

    expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a fragment spread',
      `
        query Items {
          items(block: { number: 123 }) { id }
          ...MoreItems
        }
        fragment MoreItems on Query {
          moreItems(block: { number: 123 }) { id }
        }
      `
    ],
    [
      'an inline fragment',
      `
        query Items {
          items(block: { number: 123 }) { id }
          ... on Query {
            moreItems(block: { number: 123 }) { id }
          }
        }
      `
    ],
    [
      'a second operation definition',
      `
        query Pinned {
          items(block: { number: 123 }) { id }
        }
        query Latest {
          items(block: { number_gte: 123 }) { id }
        }
      `
    ]
  ])('does not persist documents with %s', async (_selection, query) => {
    await expectNoPersistentCache(query);
  });

  it('falls through to upstream when the cache read fails', async () => {
    const query = '{ items(block: { number: 123 }) { id } }';
    mockGet.mockRejectedValueOnce(new Error('cache read failed'));

    await execute(query);

    expect(mockFetchWithKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('does not reject the request when the cache write fails', async () => {
    const query = '{ items(block: { number: 456 }) { id } }';
    mockSet.mockRejectedValueOnce(new Error('write failed'));

    await execute(query);
    await new Promise(resolve => setImmediate(resolve));
  });

  it('serves a stored falsy value from cache instead of refetching upstream', async () => {
    const query = '{ items(block: { number: 789 }) { id } }';
    mockGet.mockResolvedValueOnce(0);

    const json = jest.fn();
    const next = jest.fn();
    const req = {
      body: { query, variables: {} },
      _subgraph_url: { url: 'https://example.com/graphql' }
    } as unknown as Request;
    const res = { json } as unknown as Response;

    await processGraphql(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(mockFetchWithKeepAlive).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(0);
  });
});
