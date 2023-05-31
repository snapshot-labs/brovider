import events from 'events';

const eventEmitter = new events.EventEmitter();
eventEmitter.setMaxListeners(10000); // https://stackoverflow.com/a/26176922

export default async function serve(key, action, args) {
  return new Promise(async resolve => {
    eventEmitter.once(key, data => resolve(data));
    if (eventEmitter.listenerCount(key) === 1) {
      try {
        eventEmitter.emit(key, await action(...args));
      } catch (error: any) {
        console.log('EventEmitter Error', error);
        const errorMessage = error.message || error;
        eventEmitter.emit(key, { error: errorMessage });
      }
    }
  });
}
