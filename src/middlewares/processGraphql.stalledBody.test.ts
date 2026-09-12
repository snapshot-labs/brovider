import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import processGraphql, { graphqlQuery } from './processGraphql';
import subgraphErrorHandler from './subgraphErrorHandler';

jest.mock('../constants', () => ({
  ...jest.requireActual('../constants'),
  REQUEST_TIMEOUT: 200
}));

describe('graphql upstream whose body stalls after headers arrive', () => {
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
    url = `http://127.0.0.1:${port}/graphql`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  });

  it('rejects graphqlQuery within the configured timeout', async () => {
    const started = Date.now();

    await expect(graphqlQuery(url, '{ items { id } }', {})).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  }, 5000);

  it('returns a JSON error envelope with a valid status instead of crashing the endpoint', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req._subgraph_url = { url };
      next();
    });
    app.post('/graphql', processGraphql, subgraphErrorHandler);

    const res = await request(app)
      .post('/graphql')
      .send({ query: '{ items { id } }' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      errors: [{ message: 'The operation was aborted due to timeout' }]
    });
  }, 5000);
});
