import { Readable } from 'stream';
import { S3 } from '@aws-sdk/client-s3';
import { capture } from '@snapshot-labs/snapshot-sentry';
import { get, set } from './aws';
import { cacheHitCount } from './metrics';

jest.mock('@aws-sdk/client-s3', () => ({
  S3: jest.fn().mockImplementation(() => ({
    getObject: jest.fn(),
    putObject: jest.fn()
  }))
}));

jest.mock('@snapshot-labs/snapshot-sentry', () => ({
  capture: jest.fn()
}));

const mockClient = (S3 as unknown as jest.Mock).mock.results[0].value;
const mockGetObject = mockClient.getObject as jest.Mock;
const mockPutObject = mockClient.putObject as jest.Mock;
const mockCapture = capture as jest.Mock;

function bodyStream(content: string) {
  return Readable.from([Buffer.from(content)]);
}

function s3Error(name: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { name, ...extra });
}

async function cacheStatusCount(status: string) {
  const metric = await cacheHitCount.get();
  return metric.values.find(v => v.labels.status === status)?.value ?? 0;
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
    expect(mockCapture).toHaveBeenCalledWith(storageError, {
      contexts: { cache: { key: 'any-key', op: 'get' } }
    });
  });

  it('rethrows a NoSuchBucket 404 instead of treating it as a miss', async () => {
    const storageError = s3Error('NoSuchBucket', 'The specified bucket does not exist.', {
      $metadata: { httpStatusCode: 404 }
    });
    mockGetObject.mockRejectedValue(storageError);

    await expect(get('any-key')).rejects.toBe(storageError);
    expect(mockCapture).toHaveBeenCalledWith(storageError, {
      contexts: { cache: { key: 'any-key', op: 'get' } }
    });
  });

  it('throws a distinct error on a corrupt cache entry instead of returning it as a miss', async () => {
    mockGetObject.mockResolvedValue({ Body: bodyStream('not json') });

    await expect(get('corrupt-key')).rejects.toThrow(/corrupt cache entry: corrupt-key/);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('corrupt-key') }),
      {
        contexts: { cache: { key: 'corrupt-key', op: 'parse' } }
      }
    );
  });

  it('does not capture a miss', async () => {
    mockGetObject.mockRejectedValue(s3Error('NoSuchKey', 'no key'));

    await get('missing');

    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('returns the parsed value on a hit', async () => {
    mockGetObject.mockResolvedValue({
      Body: bodyStream(JSON.stringify({ data: { ok: true } }))
    });

    await expect(get('good-key')).resolves.toEqual({ data: { ok: true } });
  });

  it('counts MISS on a miss, READ_ERROR on a storage error, HIT on a hit', async () => {
    const missBefore = await cacheStatusCount('MISS');
    const errBefore = await cacheStatusCount('READ_ERROR');
    const hitBefore = await cacheStatusCount('HIT');

    mockGetObject.mockRejectedValueOnce(s3Error('NoSuchKey', 'no key'));
    await get('a');
    mockGetObject.mockRejectedValueOnce(s3Error('NoSuchBucket', 'no bucket'));
    await expect(get('b')).rejects.toThrow();
    mockGetObject.mockResolvedValueOnce({ Body: bodyStream(JSON.stringify({ data: 1 })) });
    await get('c');
    mockGetObject.mockResolvedValueOnce({ Body: bodyStream('nope') });
    await expect(get('d')).rejects.toThrow(/corrupt/);

    expect(await cacheStatusCount('MISS')).toBe(missBefore + 1);
    expect(await cacheStatusCount('READ_ERROR')).toBe(errBefore + 2);
    expect(await cacheStatusCount('HIT')).toBe(hitBefore + 1);
  });
});

describe('aws set()', () => {
  it('writes the value as JSON to the expected key', async () => {
    mockPutObject.mockResolvedValue({});

    await set('some-key', { data: { ok: true } });

    expect(mockPutObject).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: 'public/subgrapher/some-key',
        Body: JSON.stringify({ data: { ok: true } })
      })
    );
  });

  it('rethrows and counts WRITE_ERROR when the write fails', async () => {
    const writeErrorBefore = await cacheStatusCount('WRITE_ERROR');
    const storageError = s3Error('InternalError', 'write failed');
    mockPutObject.mockRejectedValue(storageError);

    await expect(set('some-key', { data: { ok: true } })).rejects.toBe(storageError);
    expect(await cacheStatusCount('WRITE_ERROR')).toBe(writeErrorBefore + 1);
    expect(mockCapture).toHaveBeenCalledWith(storageError, {
      contexts: { cache: { key: 'some-key', op: 'set' } }
    });
  });
});
