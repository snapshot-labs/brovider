import crypto from 'crypto';
import db from './mysql';

export function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

export function getRequestKey(network, method, params) {
  return `${network}:${method}:${sha256(JSON.stringify(params))}`;
}

export function storeRequest(network: string, method: string, archive: number, cache: number) {
  const request = { network, method, archive, count: 1, cache };
  const query = 'INSERT IGNORE INTO requests SET ? ON DUPLICATE KEY UPDATE count = count + 1';
  db.query(query, [request]);
}
