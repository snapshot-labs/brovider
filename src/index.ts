import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rpc from './rpc';
import { name, version } from '../package.json';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ maxAge: 86400 }));
app.use('/', rpc);
app.get('/', (req, res) => {
  const commit = process.env.COMMIT_HASH ?? undefined;
  res.json({ name, version, commit });
});

app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));
