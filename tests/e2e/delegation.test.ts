import express from 'express';
import request from 'supertest';
import rpc from '../../src/rpc';

describe('Delegation Endpoints', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', rpc);
  });

  describe('POST /delegation/:network', () => {
    describe('when network parameter is invalid', () => {
      it('should return 400 "Invalid network" for non-alphanumeric network', async () => {
        const response = await request(app)
          .post('/delegation/invalid-network')
          .send({
            query: '{ test }'
          })
          .expect(400);

        expect(response.body).toEqual({
          errors: [{ message: 'Invalid network' }]
        });
      });

      it('should return 400 "Invalid network" for non-existent numeric network', async () => {
        const response = await request(app)
          .post('/delegation/999999')
          .send({
            query: '{ test }'
          })
          .expect(400);

        expect(response.body).toEqual({
          errors: [{ message: 'Invalid network' }]
        });
      });
    });

    describe('when network parameter is valid', () => {
      it('should proxy GraphQL query to delegation subgraph for network "1"', async () => {
        const graphqlQuery = {
          query: `
            {
              delegations(first: 5) {
                id
                delegator
                space
                delegate
              }
            }
          `
        };

        const response = await request(app).post('/delegation/1').send(graphqlQuery);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('data');
        expect(response.body.data).toHaveProperty('delegations');
        expect(Array.isArray(response.body.data.delegations)).toBe(true);
        expect(response.body.data.delegations).toHaveLength(5);

        // Validate the structure of the first delegation
        const delegation = response.body.data.delegations[0];
        expect(delegation).toHaveProperty('id');
        expect(delegation).toHaveProperty('delegator');
        expect(delegation).toHaveProperty('space');
        expect(delegation).toHaveProperty('delegate');

        // Validate data types
        expect(typeof delegation.id).toBe('string');
        expect(typeof delegation.delegator).toBe('string');
        expect(typeof delegation.space).toBe('string');
        expect(typeof delegation.delegate).toBe('string');
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

        const response = await request(app).post('/delegation/1').send(invalidGraphqlQuery);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          errors: [
            {
              message: 'Type `Query` has no field `invalidField`'
            }
          ]
        });
      });
    });

    describe('when request body is invalid', () => {
      it('should return 400 "Invalid request" when body is missing', async () => {
        const response = await request(app).post('/delegation/1').expect(400);

        expect(response.body).toEqual({
          errors: [{ message: 'No query provided' }]
        });
      });

      it('should return 400 for malformed JSON in request body', async () => {
        await request(app)
          .post('/delegation/1')
          .set('Content-Type', 'application/json')
          .send('invalid json')
          .expect(400);
      });

      it('should return 400 for invalid JSON query string', async () => {
        const invalidQueryRequest = {
          query: '{ invalid json syntax here'
        };

        const response = await request(app)
          .post('/delegation/1')
          .send(invalidQueryRequest)
          .expect(400);

        expect(response.body).toEqual({
          errors: [
            {
              message: expect.stringMatching(/Query parse error:/)
            }
          ]
        });
      });
    });
  });
});
