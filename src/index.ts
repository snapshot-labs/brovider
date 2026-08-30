import 'dotenv/config';
import './instrument';
import { fallbackLogger } from '@snapshot-labs/snapshot-sentry';
import express from 'express';
import initMetrics from './helpers/metrics';
import { run as loadData } from './helpers/nodes';
import { initSentryFilters } from './helpers/sentry';
import mountMiddleware from './mountMiddleware';
import rpc from './rpc';
import pkg from '../package.json';

const app = express();
const PORT = process.env.PORT || 3000;

initSentryFilters();
initMetrics(app);
loadData();

app.disable('x-powered-by');
mountMiddleware(app);
app.use('/', rpc);
app.get('/', (req, res) => {
  const commit = process.env.COMMIT_HASH || '';
  const version = commit ? `${pkg.version}#${commit.substr(0, 7)}` : pkg.version;
  res.json({ version, port: PORT });
});

fallbackLogger(app);

app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));
