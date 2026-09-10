import { requestDeduplicatorSize } from './metrics';

const ongoingRequests = new Map<string, Promise<unknown>>();

export default function serve<T, A extends unknown[]>(
  key: string,
  action: (...args: A) => Promise<T>,
  args: A
): Promise<T> {
  if (!ongoingRequests.has(key)) {
    const requestPromise = action(...args)
      .then(result => result)
      .catch((error: unknown) => {
        console.log('[requestDeduplicator] request error', error);
        throw {
          errors: [{ message: (error as { message?: string })?.message }]
        };
      })
      .finally(() => {
        ongoingRequests.delete(key);
        requestDeduplicatorSize.set(ongoingRequests.size);
      });

    ongoingRequests.set(key, requestPromise);
    requestDeduplicatorSize.set(ongoingRequests.size);
  }

  return ongoingRequests.get(key) as Promise<T>;
}
