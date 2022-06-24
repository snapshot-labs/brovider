import fetch from 'cross-fetch';

export function customFetch(url, options = {}, timeout = 60000): Promise<any> {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error('API request timeout')), timeout))
  ]);
}
