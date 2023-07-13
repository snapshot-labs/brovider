import { createClient } from 'redis';
import { captureErr } from './sentry';

let client;
const url = process.env.REDIS_DATABASE_URL;

export const EXPIRE_LATEST = 3;
export const EXPIRE_ARCHIVE = 60 * 60;

(async () => {
  if (!url) return;

  client = createClient({ url });
  client.on('connect', () => console.log('redis connect'));
  client.on('ready', () => console.log('redis ready'));
  client.on('reconnecting', data => console.log('redis reconnecting', data));
  client.on('error', captureErr);
  client.on('end', data => console.log('redis end', data));

  await client.connect();

  setInterval(async () => {
    try {
      await client.set('heartbeat', ~~(Date.now() / 1e3));
    } catch (e) {
      captureErr(e);
    }
  }, 10e3);
})();

export default client;
