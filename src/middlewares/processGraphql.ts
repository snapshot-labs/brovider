import { NextFunction, Request, Response } from 'express';
import { Kind, parse, print } from 'graphql';
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
    if (!res.ok) {
      throw new Error(`Unable to connect to ${url}, code: ${res.status}`);
    } else {
      throw new Error(`Text response: ${responseData}`);
    }
  }
  return responseData;
}

async function getCachedData(key: string) {
  try {
    const cached = await get(key);
    cacheHitCount.inc({ status: cached === undefined ? 'MISS' : 'HIT' });
    return cached;
  } catch (e) {
    console.log('Read cache failed', key, e);
    cacheHitCount.inc({ status: 'READ_ERROR' });
    return undefined;
  }
}

async function setCachedData(key: string, data: any) {
  if (data?.data) {
    set(key, data).catch(e => {
      console.log('Write cache failed', key, e);
      cacheHitCount.inc({ status: 'WRITE_ERROR' });
    });
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
    if (cachedData !== undefined) {
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

  const operations = parsedQuery.definitions.filter(
    definition => definition.kind === Kind.OPERATION_DEFINITION
  );
  const operation = operations.length === 1 ? operations[0] : undefined;
  const getVariable = name =>
    variables !== null && typeof variables === 'object' && Object.hasOwn(variables, name)
      ? variables[name]
      : undefined;
  const hasValue = value =>
    value.kind === Kind.VARIABLE ? getVariable(value.name.value) != null : value.kind !== Kind.NULL;
  const isPinnedBlock = value => {
    if (value.kind === Kind.VARIABLE) {
      const block = getVariable(value.name.value);
      return (
        block !== null && typeof block === 'object' && (block.number != null || block.hash != null)
      );
    }
    return (
      value.kind === Kind.OBJECT &&
      value.fields.some(
        field =>
          (field.name.value === 'number' || field.name.value === 'hash') && hasValue(field.value)
      )
    );
  };
  const shouldCache =
    isCacheConfigured &&
    !!operation &&
    operation.selectionSet.selections.every(
      selection =>
        selection.kind === Kind.FIELD &&
        selection.arguments.some(
          argument => argument.name.value === 'block' && isPinnedBlock(argument.value)
        )
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
      return next(SubgraphError.fromGraphQLResult(result, 400));
    }
    return res.json(result);
  } catch (error: any) {
    return next(error);
  }
}
