import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { initLogger, fallbackLogger } from './sentry';
import rpc from './rpc';
import { name, version } from '../package.json';
import gracefulShutdown from './graceful-shutdown';
import { startJob } from './process-nodes';

const app = express();
const PORT = process.env.PORT || 3000;

initLogger(app);
startJob();

app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  } else {
    const pathToStatic = path.join(__dirname, '..', 'ui', '.output', 'public');
    return express.static(pathToStatic)(req, res, next);
  }
});

app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ limit: '8mb', extended: false }));
app.use(cors({ maxAge: 86400 }));
app.get('/api', (req, res) => {
  const commit = process.env.COMMIT_HASH ?? undefined;
  res.json({ name, version, commit });
});
app.use('/api', rpc);

fallbackLogger(app);

const server = app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));

gracefulShutdown(server);
