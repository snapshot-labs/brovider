import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initLogger, fallbackLogger } from '@snapshot-labs/snapshot-sentry';
import rpc from './rpc';
import pkg from '../package.json';
import initMetrics from './metrics';

const app = express();
const PORT = process.env.PORT || 3000;

initLogger(app);
initMetrics(app);

app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ limit: '4mb', extended: false }));
app.use(cors({ maxAge: 86400 }));
app.use('/', rpc);
app.get('/', (req, res) => {
  const commit = process.env.COMMIT_HASH || '';
  const version = commit ? `${pkg.version}#${commit.substr(0, 7)}` : pkg.version;
  res.json({ version, port: PORT });
});

fallbackLogger(app);

app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));
