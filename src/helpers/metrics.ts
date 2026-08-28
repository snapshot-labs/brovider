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

export const rpcCacheKeyRepeatCount = new client.Counter({
  name: 'rpc_cache_key_repeat_count',
  help:
    'HIT/MISS of sha256(network+method+params) against a bounded LRU of recently seen keys, ' +
    'not an actual cache; short window holds the 500 most recent keys per method, ' +
    'long window the 20000 most recent per method',
  labelNames: ['rpc_method', 'pinned', 'window', 'status']
});

export const rpcResponseSizeBytes = new client.Histogram({
  name: 'rpc_response_size_bytes',
  help: 'Decoded response body size of a sampled (1-in-20 per method) RPC request, before any compression',
  labelNames: ['rpc_method', 'pinned'],
  buckets: [1e3, 5e3, 20e3, 50e3, 100e3, 250e3, 500e3, 1e6, 2e6, 5e6]
});

export const nodesRefreshCount = new client.Counter({
  name: 'node_refresh_count',
  help: 'Number of node refreshes'
});
