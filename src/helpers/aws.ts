import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const CACHE_PATH = 'public';

class Aws {
  client: S3Client | null;
  subDir?: string;

  constructor(subDir?: string) {
    const region = process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!region || !accessKeyId || !secretAccessKey) this.client = null;
    else this.client = new S3Client({ endpoint: process.env.AWS_ENDPOINT });
    this.subDir = subDir;
  }

  async set(key: string, value: string) {
    try {
      const command = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: this.#path(key),
        Body: value
      });

      await this.client?.send(command);
      return true;
    } catch (e) {
      console.error('[storage:aws] Store file failed', e);
      throw new Error('Unable to access storage');
    }
  }

  async get(key: string) {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: this.#path(key)
      });
      const response = await this.client?.send(command);

      return response?.Body?.transformToString() || false;
    } catch (e) {
      return false;
    }
  }

  #path(key?: string) {
    return [CACHE_PATH, this.subDir?.replace(/^\/+|\/+$/, ''), key].filter(p => p).join('/');
  }
}

export default Aws;
