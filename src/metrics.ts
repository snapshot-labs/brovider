import init from '@snapshot-labs/snapshot-metrics';
import { Express } from 'express';

export default function initMetrics(app: Express) {
  init(app, {
    normalizedPath: [['/[0-9]+', '/#network']],
    whitelistedPath: [/^\/$/, /^\/monitor$/, /^\/[0-9]+$/]
  });
}
