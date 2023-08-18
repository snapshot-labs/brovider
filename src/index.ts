import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initLogger, fallbackLogger } from './sentry';
import rpc from './rpc';
import { name, version } from '../package.json';

const app = express();
const PORT = process.env.PORT || 3000;

initLogger(app);

app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ limit: '8mb', extended: false }));
app.use(cors({ maxAge: 86400 }));
app.get('/', (req, res) => {
  const commit = process.env.COMMIT_HASH ?? undefined;
  res.json({ name, version, commit });
});
app.use('/', rpc);

fallbackLogger(app);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));
