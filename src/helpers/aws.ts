import { Readable } from 'stream';
import * as AWS from '@aws-sdk/client-s3';

const client = new AWS.S3({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT
});

const dir = 'subgrapher';

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
    console.log('Store cache failed', e);
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
    if (e?.name === 'NoSuchKey' || e?.name === 'NotFound') return undefined;
    throw e;
  }

  try {
    return JSON.parse(str);
  } catch {
    throw new Error(`corrupt cache entry: ${key}`);
  }
}
