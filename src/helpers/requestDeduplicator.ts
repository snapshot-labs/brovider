import { REQUEST_TIMEOUT } from '../constants';

const ongoingRequests = new Map<string, Promise<any>>();

function createTimeoutPromise(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const timeoutError = new Error('Request timeout') as any;
      timeoutError.code = 408; // HTTP 408 Request Timeout
      reject(timeoutError);
    }, timeoutMs);
  });
}

export default function serve<T>(
  key: string,
  action: (...args: any[]) => Promise<T>,
  args: any[]
): Promise<T> {
  if (!ongoingRequests.has(key)) {
    const requestPromise = Promise.race([action(...args), createTimeoutPromise(REQUEST_TIMEOUT)])
      .then(result => result)
      .catch(error => {
        console.log('[requestDeduplicator] request error', error);
        throw { errors: [{ message: error.message }] };
      })
      .finally(() => {
        ongoingRequests.delete(key);
      });

    ongoingRequests.set(key, requestPromise);
  }

  return ongoingRequests.get(key)!;
}
