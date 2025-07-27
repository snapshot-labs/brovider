import { capture } from '@snapshot-labs/snapshot-sentry';
import { REQUEST_TIMEOUT } from '../constants';
import { requestDeduplicatorSize } from './metrics';

const ongoingRequests = new Map<string, Promise<any>>();

interface TimeoutError extends Error {
  code: number;
}

function createTimeoutPromise(timeoutMs: number): { promise: Promise<never>; cancel: () => void } {
  let timeoutId: NodeJS.Timeout;

  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError: TimeoutError = Object.assign(new Error('Request timeout'), {
        code: 408 // HTTP 408 Request Timeout
      });
      reject(timeoutError);
    }, timeoutMs);
  });

  const cancel = () => {
    clearTimeout(timeoutId);
  };

  return { promise, cancel };
}

export default function serve<T>(
  key: string,
  action: (...args: any[]) => Promise<T>,
  args: any[]
): Promise<T> {
  if (!ongoingRequests.has(key)) {
    const { promise: timeoutPromise, cancel: cancelTimeout } =
      createTimeoutPromise(REQUEST_TIMEOUT);
    const requestPromise = Promise.race([action(...args), timeoutPromise])
      .then(result => result)
      .catch(error => {
        console.log('[requestDeduplicator] request error', error);
        throw error;
      })
      .finally(() => {
        cancelTimeout(); // Cancel timeout regardless of outcome
        ongoingRequests.delete(key);
        requestDeduplicatorSize.set(ongoingRequests.size);
      });

    ongoingRequests.set(key, requestPromise);
    requestDeduplicatorSize.set(ongoingRequests.size);
  }

  const request = ongoingRequests.get(key);
  if (!request) {
    const error = new Error('Internal server error');
    capture(error, { context: 'requestDeduplicator', key });
    return Promise.reject(error);
  }
  return request;
}
