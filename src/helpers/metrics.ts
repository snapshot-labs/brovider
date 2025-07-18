import init, { client } from '@snapshot-labs/snapshot-metrics';
import { capture } from '@snapshot-labs/snapshot-sentry';
import { Express } from 'express';

export default function initMetrics(app: Express) {
  init(app, {
    whitelistedPath: [/^\/$/, /^\/.*$/],
    errorHandler: capture
  });
}

export const cacheHitCount = new client.Counter({
  name: 'cache_hit_count',
  help: 'Number of hit/miss of the cache layer',
  labelNames: ['status']
});
