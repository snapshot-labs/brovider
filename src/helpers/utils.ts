import { createHash } from 'crypto';
import http from 'node:http';
import https from 'node:https';
import fetch, { RequestInit } from 'node-fetch';

const DEFAULT_FETCH_TIMEOUT = 30000;
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });
const agent: RequestInit['agent'] = url =>
  url.protocol === 'http:' ? httpAgent : httpsAgent;

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function sha256(str: string): string {
  return createHash('sha256').update(str).digest('hex');
}

interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number;
}

export const fetchWithKeepAlive = async (
  uri: string | URL,
  options: FetchWithTimeoutOptions = {}
): Promise<{ status: number; ok: boolean; text: string }> => {
  const { timeout = DEFAULT_FETCH_TIMEOUT, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(uri, {
      agent,
      signal: controller.signal,
      ...fetchOptions
    });
    const text = await response.text();

    return { status: response.status, ok: response.ok, text };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};
