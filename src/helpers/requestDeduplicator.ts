import { requestDeduplicatorSize } from './metrics';

const ongoingRequests = new Map();

export default function serve(key, action, args) {
  if (!ongoingRequests.has(key)) {
    const requestPromise = action(...args)
      .then(result => result)
      .catch(error => {
        console.log('[requestDeduplicator] request error', error);
        throw { errors: [{ message: error.message }] };
      })
      .finally(() => {
        ongoingRequests.delete(key);
        requestDeduplicatorSize.set(ongoingRequests.size);
      });

    ongoingRequests.set(key, requestPromise);
    requestDeduplicatorSize.set(ongoingRequests.size);
  }

  return ongoingRequests.get(key);
}
