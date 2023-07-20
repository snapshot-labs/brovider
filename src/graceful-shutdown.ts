import redis from './redis';
import { db } from './mysql';

export default function (server) {
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  function cleanup() {
    console.info('SIGTERM signal received.');
    console.log('Closing http server.');
    server.close(async err => {
      if (err) {
        console.error('Error closing http server:', err);
      } else {
        console.log('Http server closed.');
      }

      console.log('Closing redis connection.');
      try {
        await redis.quit();
        console.log('Redis connection closed.');
      } catch (err) {
        console.error('Error closing redis connection:', err);
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
