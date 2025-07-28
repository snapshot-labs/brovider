import { createHash } from 'crypto';
import https from 'node:https';
import fetch, { RequestInit, Response } from 'node-fetch';

const DEFAULT_FETCH_TIMEOUT = 30000;
const httpsAgent = new https.Agent({ keepAlive: true });

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
): Promise<Response> => {
  const { timeout = DEFAULT_FETCH_TIMEOUT, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(uri, {
      agent: httpsAgent,
      signal: controller.signal,
      ...fetchOptions
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};
