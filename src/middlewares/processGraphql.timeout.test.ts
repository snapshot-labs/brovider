jest.mock('../constants', () => ({
  ...jest.requireActual('../constants'),
  REQUEST_TIMEOUT: 200
}));

import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import processGraphql, { graphqlQuery } from './processGraphql';
import subgraphErrorHandler from './subgraphErrorHandler';

async function unusedLocalUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

function buildApp(subgraphUrl: string) {
  const app = express();
  app.use(express.json());
  app.post(
    '/test',
    (req: Request, _res: Response, next: NextFunction) => {
      (req as any)._subgraph_url = { url: subgraphUrl };
      next();
    },
    processGraphql,
    subgraphErrorHandler
  );
  return app;
}

describe('graphql upstream timeout handling', () => {
  let server: Server;
  let stalledBodyUrl: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      res.write('{"data":');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    stalledBodyUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  });

  it('settles graphqlQuery instead of hanging when the body stalls after headers arrive', async () => {
    const started = Date.now();

    await expect(
      graphqlQuery(stalledBodyUrl, '{ items { id } }')
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  }, 5000);

  it('responds with a valid HTTP status and a JSON error envelope instead of crashing', async () => {
    const app = buildApp(stalledBodyUrl);

    const res = await request(app)
      .post('/test')
      .send({ query: '{ items { id } }' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ errors: [{ message: expect.any(String) }] });
  }, 5000);

  it('surfaces the transport error code rather than the generic undici message', async () => {
    const app = buildApp(await unusedLocalUrl());

    const res = await request(app)
      .post('/test')
      .send({ query: '{ items { id } }' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      errors: [{ message: 'ECONNREFUSED' }]
    });
  }, 5000);
});
