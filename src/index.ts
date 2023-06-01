import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rpc from './rpc';
import { name, version } from '../package.json';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ maxAge: 86400 }));
app.get('/', (req, res) => {
  const commit = process.env.COMMIT_HASH ?? undefined;
  res.json({ name, version, commit });
});
app.use('/', rpc);

app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));
