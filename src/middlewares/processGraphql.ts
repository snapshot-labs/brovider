import { capture } from '@snapshot-labs/snapshot-sentry';
import { NextFunction, Request, Response } from 'express';
import { parse, print } from 'graphql';
import { REQUEST_TIMEOUT } from '../constants';
import { SubgraphError } from '../errors/SubgraphError';
import { get, set } from '../helpers/aws';
import { cacheHitCount } from '../helpers/metrics';
import serve from '../helpers/requestDeduplicator';
import { fetchWithKeepAlive, sha256 } from '../helpers/utils';

const isCacheConfigured = !!process.env.AWS_REGION;

export async function graphqlQuery(url: string, query: string, variables = {}) {
  const res = await fetchWithKeepAlive(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: REQUEST_TIMEOUT,
    body: JSON.stringify({ query, variables })
  });
  let responseData: any = await res.text();
  try {
    responseData = JSON.parse(responseData);
  } catch (e) {
    capture({ error: { code: res.status, message: res.statusText } }, { url });

    if (!res.ok) {
      throw new Error(`Unable to connect to ${url}, code: ${res.status}`);
    } else {
      throw new Error(`Text response: ${responseData}`);
    }
  }
  return responseData;
}

async function getCachedData(key: string) {
  const cachedData = await get(key);
  if (cachedData) {
    cacheHitCount.inc({ status: 'HIT' });
    return cachedData;
  }
  cacheHitCount.inc({ status: 'MISS' });
  return null;
}

async function setCachedData(key: string, data: any) {
  if (data?.data) {
    set(key, data).catch(capture);
  }
}

export async function getData(
  url: string,
  query: string,
  variables = {},
  key: string,
  isCacheEnabled: boolean
) {
  if (isCacheEnabled) {
    const cachedData = await getCachedData(key);
    if (cachedData) {
      return cachedData;
    }
  }

  const result = await graphqlQuery(url, query, variables);

  if (isCacheEnabled) {
    await setCachedData(key, result);
  }

  return result;
}

export default async function processGraphql(req: Request, res: Response, next: NextFunction) {
  const subgraphUrl = (req as any)._subgraph_url.url;

  if (!req.body) {
    return next(new SubgraphError('No query provided', 400));
  }

  const { query, variables = {} } = req.body;

  let parsedQuery: any;
  try {
    parsedQuery = parse(query);
  } catch (error: any) {
    return next(new SubgraphError(`Query parse error: ${error.message}`, 400));
  }

  const normalizedQuery = print(parsedQuery);
  const cacheKey =
    variables && Object.keys(variables).length > 0
      ? sha256(`${subgraphUrl}:${normalizedQuery}:${JSON.stringify(variables)}`)
      : sha256(`${subgraphUrl}:${normalizedQuery}`);

  const shouldCache =
    isCacheConfigured &&
    parsedQuery.definitions[0].selectionSet.selections.every(selection =>
      selection.arguments.some(argument => argument.name.value === 'block')
    );
  try {
    const result: any = await serve(cacheKey, getData, [
      subgraphUrl,
      normalizedQuery,
      variables,
      cacheKey,
      shouldCache
    ]);
    if (result.errors) {
      capture(new Error('GraphQl error'), result.errors);
      return next(SubgraphError.fromGraphQLResult(result, 400));
    }
    return res.json(result);
  } catch (error: any) {
    return next(error);
  }
}
