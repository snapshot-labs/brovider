import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { fetchWithKeepAlive } from './utils';

describe('fetchWithKeepAlive', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      res.write('{"data":');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  });

  it('rejects a response whose body stalls after headers arrive, within the timeout', async () => {
    const started = Date.now();
    const res = await fetchWithKeepAlive(url, { timeout: 200 });

    await expect(res.text()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  }, 5000);
});
