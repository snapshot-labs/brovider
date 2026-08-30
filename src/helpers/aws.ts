import * as AWS from '@aws-sdk/client-s3';

const client = new AWS.S3({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT
});

const dir = 'subgrapher';

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
  try {
    const { Body } = await client.getObject({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `public/${dir}/${key}`
    });
    return JSON.parse(await Body!.transformToString());
  } catch (e) {
    return false;
  }
}
