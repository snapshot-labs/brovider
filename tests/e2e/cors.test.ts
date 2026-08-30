import cors from 'cors';
import express from 'express';
import request from 'supertest';
import handleJsonParseError from '../../src/middlewares/handleJsonParseError';

describe('CORS on a body-parser error response', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(cors({ maxAge: 86400 }));
    app.use(express.json({ limit: '4mb' }));
    app.use(handleJsonParseError);
    app.post('/1', (_req, res) => res.json({ ok: true }));
  });

  it('carries Access-Control-Allow-Origin on the -32700 parse-error response', async () => {
    const response = await request(app)
      .post('/1')
      .set('Content-Type', 'application/json')
      .send('not json')
      .expect(400);

    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.body).toMatchObject({ error: { code: -32700 } });
  });

  it('carries Access-Control-Allow-Origin on a well-formed request too', async () => {
    const response = await request(app)
      .post('/1')
      .set('Content-Type', 'application/json')
      .send({ ok: true })
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('*');
  });
});
