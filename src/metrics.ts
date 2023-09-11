import init from '@snapshot-labs/snapshot-metrics';
import { capture } from '@snapshot-labs/snapshot-sentry';
import { Express } from 'express';

export default function initMetrics(app: Express) {
  init(app, {
    normalizedPath: [['/[0-9]+', '/#network']],
    whitelistedPath: [/^\/$/, /^\/monitor$/, /^\/[0-9]+$/],
    errorHandler: (e: any) => capture(e)
  });
}
