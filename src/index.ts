import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initLogger, fallbackLogger } from './sentry';
import rpc from './rpc';
import api from './api';
import { name, version } from '../package.json';
import gracefulShutdown from './graceful-shutdown';
import { startJob } from './process-nodes';

const app = express();
const PORT = process.env.PORT || 3000;

initLogger(app);

if (process.env.NODE_APP_INSTANCE === '0') {
  startJob();
}

app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ limit: '8mb', extended: false }));
app.use(cors({ maxAge: 86400 }));
app.get('/', (req, res) => {
  const commit = process.env.COMMIT_HASH ?? undefined;
  res.json({ name, version, commit });
});
app.use('/', rpc);
app.use('/api', api);

fallbackLogger(app);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));

gracefulShutdown(server);
