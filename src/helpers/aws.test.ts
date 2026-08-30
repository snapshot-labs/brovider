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

function s3Error(name: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { name, ...extra });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aws get()', () => {
  it('returns undefined on a NoSuchKey miss', async () => {
    mockGetObject.mockRejectedValue(s3Error('NoSuchKey', 'The specified key does not exist.'));

    await expect(get('missing')).resolves.toBeUndefined();
  });

  it('returns undefined on a NotFound miss', async () => {
    mockGetObject.mockRejectedValue(
      s3Error('NotFound', 'Not Found', { $metadata: { httpStatusCode: 404 } })
    );

    await expect(get('missing')).resolves.toBeUndefined();
  });

  it('rethrows a non-404 storage error instead of treating it as a miss', async () => {
    const storageError = s3Error('AccessDenied', 'access denied', {
      $metadata: { httpStatusCode: 403 }
    });
    mockGetObject.mockRejectedValue(storageError);

    await expect(get('any-key')).rejects.toBe(storageError);
  });

  it('rethrows a NoSuchBucket 404 instead of treating it as a miss', async () => {
    const storageError = s3Error('NoSuchBucket', 'The specified bucket does not exist.', {
      $metadata: { httpStatusCode: 404 }
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
