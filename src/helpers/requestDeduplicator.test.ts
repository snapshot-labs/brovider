import { createServer } from 'http';
import { AddressInfo } from 'net';
import serve from './requestDeduplicator';

async function getClosedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
  return port;
}

describe('requestDeduplicator', () => {
  it('normalizes a native fetch transport failure to its cause code', async () => {
    const port = await getClosedPort();

    await expect(
      serve(
        `refused-${port}`,
        () => fetch(`http://127.0.0.1:${port}/graphql`, { method: 'POST' }),
        []
      )
    ).rejects.toEqual({ errors: [{ message: 'ECONNREFUSED' }] });
  });

  it('falls back to the error message when there is no cause code', async () => {
    await expect(
      serve(
        `plain-${Date.now()}`,
        async () => {
          throw new Error('boom');
        },
        []
      )
    ).rejects.toEqual({ errors: [{ message: 'boom' }] });
  });
});
