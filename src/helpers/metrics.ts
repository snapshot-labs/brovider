import init, { client } from '@snapshot-labs/snapshot-metrics';
import { capture } from '@snapshot-labs/snapshot-sentry';
import { Express, Request } from 'express';

export default function initMetrics(app: Express) {
  init(app, {
    whitelistedPath: [
      /^\/$/,
      /^\/\d+\/?$/,
      /^\/sn\/?$/,
      /^\/sn-sep\/?$/,
      /^\/delegation\/[a-zA-Z0-9]+\/?$/,
      /^\/subgraph\/[a-zA-Z]+\/[^\/]+\/?$/
    ],
    normalizedPath: (req: Request) => {
      const raw = (req.baseUrl || '') + (req.path || '');
      const url = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
      const subgraphMatch = url.match(/^\/subgraph\/([a-zA-Z]+)\//);
      if (subgraphMatch) return `/subgraph/${subgraphMatch[1]}`;
      return url;
    },
    errorHandler: capture,
    promBundleOptions: {
      buckets: [0.03, 0.3, 1.5, 3, 5, 7, 10]
    }
  });
}

export const cacheHitCount = new client.Counter({
  name: 'cache_hit_count',
  help: 'Number of cache lookups by outcome (status label)',
  labelNames: ['status']
});

export const requestDeduplicatorSize = new client.Gauge({
  name: 'request_deduplicator_size',
  help: 'Total number of items in the deduplicator queue'
});

export const rpcRequestCount = new client.Counter({
  name: 'rpc_request_count',
  help: 'Number of proxied RPC requests',
  labelNames: ['network', 'client', 'rpc_method']
});

export const rpcCacheCount = new client.Counter({
  name: 'rpc_cache_count',
  help: 'RPC requests by cache result: hit, shared, miss or unpinned',
  labelNames: ['network', 'rpc_method', 'result']
});

export const rpcCacheStoreCount = new client.Counter({
  name: 'rpc_cache_store_count',
  help: 'Upstream answers to cacheable requests: stored, or why not',
  labelNames: ['network', 'rpc_method', 'result']
});

export const rpcCacheMismatchCount = new client.Counter({
  name: 'rpc_cache_mismatch_count',
  help: 'Cached answers that differ from the node answer (shadow mode)',
  labelNames: ['network', 'rpc_method']
});

export const rpcCacheEvictions = new client.Counter({
  name: 'rpc_cache_evictions',
  help: 'Least recently used answers removed to stay under the size budget'
});

export const nodesRefreshCount = new client.Counter({
  name: 'node_refresh_count',
  help: 'Number of node refreshes'
});
