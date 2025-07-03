import { createHash } from 'crypto';
import https from 'node:https';
import fetch from 'node-fetch';

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

const httpsAgent = new https.Agent({ keepAlive: true });
export const fetchWithKeepAlive = (uri: any, options: any = {}) => {
  return fetch(uri, { agent: httpsAgent, ...options });
};
