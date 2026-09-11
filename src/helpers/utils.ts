import { createHash } from 'crypto';

const DEFAULT_FETCH_TIMEOUT = 30000;

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
  { timeout = DEFAULT_FETCH_TIMEOUT, ...init }: FetchWithTimeoutOptions = {}
): Promise<Response> =>
  fetch(uri, { ...init, signal: AbortSignal.timeout(timeout) });
