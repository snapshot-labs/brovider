import crypto from 'crypto';
import db from './mysql';

export function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

export function getRequestKey(network, method, params) {
  return `${network}:${method}:${sha256(JSON.stringify(params))}`;
}
