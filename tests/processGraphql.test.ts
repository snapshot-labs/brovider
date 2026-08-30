import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextFunction, Request, Response } from 'express';

// Bound to the mock factories below rather than re-imported, so the references
// hold regardless of module-registry timing.
const mockGet = mock<(key: string) => Promise<any>>(async () => false);
const mockSet = mock<(key: string, value: any) => Promise<any>>(async () => ({}));
const mockFetchWithKeepAlive = mock<(...args: any[]) => Promise<any>>(async () => undefined);

const actualUtils = await import('../src/helpers/utils');

mock.module('../src/helpers/aws', () => ({ get: mockGet, set: mockSet }));
mock.module('../src/helpers/utils', () => ({
  ...actualUtils,
  fetchWithKeepAlive: mockFetchWithKeepAlive
}));

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
  const json = mock();
  const next = mock();
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
  processGraphql = (await import('../src/middlewares/processGraphql')).default;
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
  mockGet.mockClear();
  mockSet.mockClear();
  mockFetchWithKeepAlive.mockClear();
  mockGet.mockImplementation(async key => cachedResponses.get(key) ?? false);
  mockSet.mockImplementation(async (key, value) => {
    cachedResponses.set(key, value);
    return {} as any;
  });
  mockFetchWithKeepAlive.mockImplementation(async () => response());
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
});
