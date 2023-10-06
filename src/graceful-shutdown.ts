import redis from './redis';
import { db } from './mysql';
import { stopJob } from './process-nodes';
import { close } from './cluster-sync';

export default function (server) {
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGUSR2', cleanup); // nodemon restart

  async function cleanup(signal) {
    console.info(`"${signal}" signal received.`);
    console.log('Closing http server.');
    await stopJob();
    close().then(() => console.log('cluster-sync closed'));
    server.close(async err => {
      if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
        console.error('Error closing http server:', err);
      } else {
        console.log('Http server closed.');
      }

      console.log('Closing redis connection.');
      try {
        if (typeof redis !== 'undefined') {
          await redis.quit();
          console.log('Redis connection closed.');
        }
      } catch (err) {
        if ((err as any).message !== 'The client is closed') {
          console.error('Error closing redis connection:', err);
        } else {
          console.log('Redis connection closed.');
        }
      }

      console.log('Closing mysql connection.');
      try {
        await db.end();
        console.log('Mysql connection closed.');
      } catch (err) {
        console.error('Error closing mysql connection:', err);
      }

      console.log('Exiting process.');
      process.exit(0);
    });
  }
}
