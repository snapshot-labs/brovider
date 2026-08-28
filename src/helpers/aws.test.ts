import { Readable } from 'stream';
import { S3 } from '@aws-sdk/client-s3';
import { get } from './aws';

jest.mock('@aws-sdk/client-s3', () => ({
  S3: jest.fn().mockImplementation(() => ({
    getObject: jest.fn(),
    putObject: jest.fn()
  }))
}));

const mockClient = (S3 as unknown as jest.Mock).mock.results[0].value;
const mockGetObject = mockClient.getObject as jest.Mock;

function bodyStream(content: string) {
  return Readable.from([Buffer.from(content)]);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aws get()', () => {
  it('returns undefined on a NoSuchKey miss', async () => {
    mockGetObject.mockRejectedValue(
      Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' })
    );

    await expect(get('missing')).resolves.toBeUndefined();
  });

  it('returns undefined on a 404 without the NoSuchKey name', async () => {
    mockGetObject.mockRejectedValue(
      Object.assign(new Error('Not Found'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 }
      })
    );

    await expect(get('missing')).resolves.toBeUndefined();
  });

  it('rethrows a non-404 storage error instead of treating it as a miss', async () => {
    const storageError = Object.assign(new Error('access denied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 }
    });
    mockGetObject.mockRejectedValue(storageError);

    await expect(get('any-key')).rejects.toBe(storageError);
  });

  it('throws a distinct error on a corrupt cache entry instead of returning it as a miss', async () => {
    mockGetObject.mockResolvedValue({ Body: bodyStream('not json') });

    await expect(get('corrupt-key')).rejects.toThrow(/corrupt cache entry: corrupt-key/);
  });

  it('returns the parsed value on a hit', async () => {
    mockGetObject.mockResolvedValue({
      Body: bodyStream(JSON.stringify({ data: { ok: true } }))
    });

    await expect(get('good-key')).resolves.toEqual({ data: { ok: true } });
  });
});
