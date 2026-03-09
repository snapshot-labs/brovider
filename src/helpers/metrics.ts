import init, { client } from '@snapshot-labs/snapshot-metrics';
import { capture } from '@snapshot-labs/snapshot-sentry';
import { Express, Request } from 'express';

export default function initMetrics(app: Express) {
  init(app, {
    whitelistedPath: [
      /^\/$/,
      /^\/\d+$/,
      /^\/sn$/,
      /^\/sn-sep$/,
      /^\/delegation\/[a-zA-Z0-9]+$/,
      /^\/subgraph\/[a-zA-Z]+\/[^\/]+$/
    ],
    normalizedPath: (req: Request) => {
      const url = (req.baseUrl || '') + (req.path || '');
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
  help: 'Number of hit/miss of the cache layer',
  labelNames: ['status']
});

export const requestDeduplicatorSize = new client.Gauge({
  name: 'request_deduplicator_size',
  help: 'Total number of items in the deduplicator queue'
});

export const nodesRefreshCount = new client.Counter({
  name: 'node_refresh_count',
  help: 'Number of node refreshes'
});
