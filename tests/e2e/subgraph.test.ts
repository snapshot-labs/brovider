import express from 'express';
import request from 'supertest';
import rpc from '../../src/rpc';

describe('Subgraph Endpoints', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', rpc);
  });

  describe('POST /subgraph/:network/:subgraph', () => {
    describe('when network parameter is invalid', () => {
      it('should return 400 "Invalid url" for non-existent network', async () => {
        const response = await request(app)
          .post('/subgraph/invalid-network/test-subgraph-id')
          .send({
            query: '{ test }'
          })
          .expect(400);

        expect(response.body).toEqual({
          errors: [{ message: 'Invalid url' }]
        });
      });
    });

    describe('when network and subgraph parameters are valid', () => {
      it('should proxy GraphQL query to subgraph for arbitrum network', async () => {
        const graphqlQuery = {
          query: `
            {
              tokens(first: 3) {
                id
              }
            }
          `
        };

        const response = await request(app)
          .post('/subgraph/arbitrum/A6EEuSAB7mFrWvLBnL1HZXwfiGfqFYnFJjc14REtMNkd')
          .send(graphqlQuery);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('data');
        expect(response.body.data).toHaveProperty('tokens');
        expect(Array.isArray(response.body.data.tokens)).toBe(true);
        expect(response.body.data.tokens).toHaveLength(3);

        // Validate the structure of the first token
        const token = response.body.data.tokens[0];
        expect(token).toHaveProperty('id');
        expect(typeof token.id).toBe('string');
      });

      it('should handle invalid GraphQL syntax gracefully', async () => {
        const invalidGraphqlQuery = {
          query: `
            query {
              invalidField {
                nonExistentProperty
              }
            }
          `
        };

        const response = await request(app)
          .post('/subgraph/arbitrum/A6EEuSAB7mFrWvLBnL1HZXwfiGfqFYnFJjc14REtMNkd')
          .send(invalidGraphqlQuery);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('errors');
        expect(Array.isArray(response.body.errors)).toBe(true);
        expect(response.body.errors.length).toBeGreaterThan(0);

        // Validate the error structure
        const error = response.body.errors[0];
        expect(error).toHaveProperty('message');
        expect(typeof error.message).toBe('string');
      });
    });

    describe('when subgraph parameter is missing', () => {
      it('should return 404 for route "/subgraph/:network" (subgraph required)', async () => {
        const response = await request(app)
          .post('/subgraph/mainnet')
          .send({
            query: '{ test }'
          })
          .expect(404);

        expect(response.status).toBe(404);
      });
    });

    describe('when request body is invalid', () => {
      it('should return 400 "Invalid request" when body is missing', async () => {
        const response = await request(app).post('/subgraph/mainnet/test-id').expect(400);

        expect(response.body).toEqual({
          error: 'Invalid request'
        });
      });

      it('should return 400 for malformed JSON in request body', async () => {
        await request(app)
          .post('/subgraph/mainnet/test-id')
          .set('Content-Type', 'application/json')
          .send('invalid json')
          .expect(400);
      });
    });
  });
});
