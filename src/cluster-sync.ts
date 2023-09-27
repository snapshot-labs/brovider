import { createClient } from 'redis';

const channelName = 'interprocess-channel';
const processId = process.env.NODE_APP_INSTANCE ?? '0';
const redisUrl = process.env.REDIS_DATABASE_URL || 'redis://localhost:6379';

console.log('redisUrl', redisUrl);
const subscriber = createClient({ url: redisUrl });
const publisher = subscriber.duplicate();

(async () => {
  await subscriber.connect();
  await publisher.connect();
})();

const sync = async (topic: string, payload = {}) => {
  const data = JSON.stringify({ topic, payload, processId });
  await publisher.publish(channelName, data);
};

const onSync = (topic: string, callback: any) => {
  subscriber.subscribe(channelName, message => {
    try {
      const { topic: messageTopic, payload, processId: pid } = JSON.parse(message);
      if (pid === processId) return;
      if (topic !== messageTopic) return;
      callback(payload);
    } catch (error) {
      console.error('onSync', error);
      callback(null);
    }
  });
};

const close = async () => {
  await subscriber.quit();
  await publisher.quit();
};

export { sync, onSync, close };
