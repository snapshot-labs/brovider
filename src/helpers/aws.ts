import { Readable } from 'stream';
import * as AWS from '@aws-sdk/client-s3';
import { capture } from '@snapshot-labs/snapshot-sentry';
import { cacheHitCount } from './metrics';

const client = new AWS.S3({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT
});

const dir = 'subgrapher';

// capture() below is unsampled (one Sentry event per failed op), fine at today's
// subgraph-only call volume; a higher-traffic caller adopting get()/set() needs
// its own gating before that stops being true.

async function streamToString(stream: Readable): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

export async function set(key, value) {
  try {
    return await client.putObject({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `public/${dir}/${key}`,
      Body: JSON.stringify(value),
      ContentType: 'application/json; charset=utf-8'
    });
  } catch (e) {
    console.log('Store cache failed', key, e);
    cacheHitCount.inc({ status: 'WRITE_ERROR' });
    capture(e, { contexts: { cache: { key, op: 'set' } } });
    throw e;
  }
}

export async function get(key) {
  let str: string;
  try {
    const { Body } = await client.getObject({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `public/${dir}/${key}`
    });
    // @ts-ignore
    str = await streamToString(Body);
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.name === 'NotFound') {
      cacheHitCount.inc({ status: 'MISS' });
      return undefined;
    }
    console.log('Read cache failed', key, e);
    cacheHitCount.inc({ status: 'READ_ERROR' });
    capture(e, { contexts: { cache: { key, op: 'get' } } });
    throw e;
  }

  let value: any;
  try {
    value = JSON.parse(str);
  } catch {
    console.log('Read cache failed, corrupt entry', key);
    cacheHitCount.inc({ status: 'READ_ERROR' });
    const corruptError = new Error(`corrupt cache entry: ${key}`);
    capture(corruptError, { contexts: { cache: { key, op: 'parse' } } });
    throw corruptError;
  }
  cacheHitCount.inc({ status: 'HIT' });
  return value;
}
