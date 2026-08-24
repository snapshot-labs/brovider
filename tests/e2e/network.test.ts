import { Server } from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { nodes, stop } from '../../src/helpers/nodes';
import rpc from '../../src/rpc';

describe('Network Endpoint E2E Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', rpc);
  });

  describe('Cached Methods', () => {
    let configuredNodes: Record<string, string>;
    let originalNodes: Record<string, string | undefined>;
    let upstream: Server;
    let upstreamRequests = 0;
    let upstreamBody: unknown;

    beforeAll(async () => {
      stop();
      const upstreamApp = express();
      upstreamApp.use(express.json());
      upstreamApp.post('/', (req, res) => {
        upstreamRequests += 1;
        upstreamBody = req.body;
        res.json({ jsonrpc: req.body.jsonrpc, id: req.body.id, result: 'upstream-chain-id' });
      });
      upstream = await new Promise(resolve => {
        const server = upstreamApp.listen(0, '127.0.0.1', () => resolve(server));
      });
      const { port } = upstream.address() as AddressInfo;
      const upstreamUrl = `http://127.0.0.1:${port}`;
      configuredNodes = nodes as Record<string, string>;
      originalNodes = {
        '1': configuredNodes['1'],
        '10': configuredNodes['10'],
        sn: configuredNodes.sn,
        'sn-sep': configuredNodes['sn-sep'],
        '0x1': configuredNodes['0x1']
      };
      configuredNodes['1'] = upstreamUrl;
      configuredNodes['10'] = upstreamUrl;
      configuredNodes.sn = upstreamUrl;
      configuredNodes['sn-sep'] = upstreamUrl;
      configuredNodes['0x1'] = upstreamUrl;
    });

    beforeEach(() => {
      upstreamRequests = 0;
      upstreamBody = undefined;
    });

    afterAll(async () => {
      for (const [network, url] of Object.entries(originalNodes)) {
        if (url === undefined) {
          delete configuredNodes[network];
        } else {
          configuredNodes[network] = url;
        }
      }
      await new Promise<void>((resolve, reject) => {
        upstream.close(error => (error ? reject(error) : resolve()));
      });
    });

    describe('eth_chainId', () => {
      it('should convert decimal network IDs to hex chainId without an upstream request', async () => {
        const testCases = [
          { network: '1', expected: '0x1' },
          { network: '10', expected: '0xa' },
          { network: '137', expected: '0x89' },
          { network: '42161', expected: '0xa4b1' }
        ];

        for (const testCase of testCases) {
          const response = await request(app)
            .post(`/${testCase.network}`)
            .send({
              jsonrpc: '2.0',
              method: 'eth_chainId',
              params: [],
              id: 1
            })
            .expect(200);

          expect(response.body).toEqual({
            jsonrpc: '2.0',
            id: 1,
            result: testCase.expected
          });
        }
        expect(upstreamRequests).toBe(0);
      });

      it.each([
        { network: 'sn', type: 'nonnumeric' },
        { network: '0x1', type: 'coercible non-decimal' }
      ])('should proxy eth_chainId for a $type network', async ({ network }) => {
        const body = {
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [network, { nested: ['value'] }],
          id: 2
        };
        const response = await request(app).post(`/${network}`).send(body).expect(200);

        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 2,
          result: 'upstream-chain-id'
        });
        expect(upstreamRequests).toBe(1);
        expect(upstreamBody).toEqual(body);
      });
    });

    describe('starknet_chainId', () => {
      it.each([
        { network: 'sn', expected: '0x534e5f4d41494e' },
        { network: 'sn-sep', expected: '0x534e5f5345504f4c4941' }
      ])(
        'should answer $network locally without an upstream request',
        async ({ network, expected }) => {
          const response = await request(app)
            .post(`/${network}`)
            .send({
              jsonrpc: '2.0',
              method: 'starknet_chainId',
              params: [],
              id: 3
            })
            .expect(200);

          expect(response.body).toEqual({
            jsonrpc: '2.0',
            id: 3,
            result: expected
          });
          expect(upstreamRequests).toBe(0);
        }
      );

      it('should proxy starknet_chainId for a decimal network', async () => {
        const body = {
          jsonrpc: '2.0',
          method: 'starknet_chainId',
          params: [],
          id: 4
        };
        const response = await request(app).post('/1').send(body).expect(200);

        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 4,
          result: 'upstream-chain-id'
        });
        expect(upstreamRequests).toBe(1);
        expect(upstreamBody).toEqual(body);
      });

      it.each(['sn', 'sn-sep'])('should proxy other methods for %s', async network => {
        const body = {
          jsonrpc: '2.0',
          method: 'starknet_blockNumber',
          params: [],
          id: 5
        };
        const response = await request(app).post(`/${network}`).send(body).expect(200);

        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 5,
          result: 'upstream-chain-id'
        });
        expect(upstreamRequests).toBe(1);
        expect(upstreamBody).toEqual(body);
      });
    });
  });

  describe('Proxied Methods', () => {
    it('should return valid JSON-RPC response for valid proxied request', async () => {
      const response = await request(app)
        .post('/1')
        .send({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1
        })
        .expect(200);

      expect(response.body).toEqual({
        id: 1,
        jsonrpc: '2.0',
        result: expect.stringMatching(/^0x/)
      });
    });
  });

  describe('Error Handling', () => {
    describe('Request Validation Errors', () => {
      it('should return 400 for missing request body', async () => {
        const response = await request(app).post('/1').expect(400);

        expect(response.body).toEqual({
          error: 'Invalid request'
        });
      });

      it('should return 400 for malformed JSON', async () => {
        await request(app)
          .post('/1')
          .set('Content-Type', 'application/json')
          .send('invalid json')
          .expect(400);
      });

      it('should return 404 for invalid network', async () => {
        const response = await request(app)
          .post('/999999')
          .send({
            jsonrpc: '2.0',
            method: 'eth_chainId',
            params: [],
            id: 1
          })
          .expect(404);

        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 1,
          error: 'Invalid network'
        });
      });

      it('should return 404 for an inherited numeric network key', async () => {
        Object.defineProperty(Object.prototype, '12345', {
          configurable: true,
          value: 'inherited-node'
        });

        try {
          const response = await request(app).post('/12345').send({
            jsonrpc: '2.0',
            method: 'eth_chainId',
            params: [],
            id: 1
          });

          expect(response.body).toEqual({
            jsonrpc: '2.0',
            id: 1,
            error: 'Invalid network'
          });
          expect(response.status).toBe(404);
        } finally {
          delete (Object.prototype as Record<string, unknown>)['12345'];
        }
      });

      it.each(['doesnotexist', '__proto__'])(
        'should return 404 for unknown nonnumeric network %s',
        async network => {
          const response = await request(app)
            .post(`/${network}`)
            .send({
              jsonrpc: '2.0',
              method: 'eth_chainId',
              params: [],
              id: 2
            })
            .expect(404);

          expect(response.body).toEqual({
            jsonrpc: '2.0',
            id: 2,
            error: 'Invalid network'
          });
        }
      );
    });

    describe('JSON-RPC Errors', () => {
      it('should return error when method is missing', async () => {
        const response = await request(app)
          .post('/1')
          .send({
            jsonrpc: '2.0',
            params: [],
            id: 1
          })
          .expect(200);

        expect(response.body).toEqual({
          id: 1,
          jsonrpc: '2.0',
          error: {
            code: expect.any(Number),
            message: expect.any(String)
          }
        });
      });

      it('should return error for invalid method', async () => {
        const response = await request(app)
          .post('/1')
          .send({
            jsonrpc: '2.0',
            method: 'invalid_method_name',
            params: [],
            id: 2
          })
          .expect(200);

        expect(response.body).toMatchObject({
          id: 2,
          jsonrpc: '2.0',
          error: {
            code: expect.any(Number),
            message: expect.stringMatching(/not (supported|available|found)|does not exist/i)
          }
        });
      });

      it('should return error -32602 for invalid parameters', async () => {
        const response = await request(app)
          .post('/1')
          .send({
            jsonrpc: '2.0',
            method: 'eth_getBlockByNumber',
            params: ['hello'],
            id: 1
          })
          .expect(200);

        expect(response.body).toMatchObject({
          id: 1,
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: expect.stringMatching(/invalid/i)
          }
        });
      });
    });

    it('should return 500 "Invalid node URL configuration" for network with invalid database URL', async () => {
      const response = await request(app)
        .post('/11001100')
        .send({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1
        })
        .expect(500);

      expect(response.body).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: 'Invalid node URL configuration'
      });
    });
  });

  describe('JSON-RPC Protocol Compliance', () => {
    it('should preserve jsonrpc version in responses', async () => {
      const response = await request(app)
        .post('/1')
        .send({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 'test-id'
        })
        .expect(200);

      expect(response.body.jsonrpc).toBe('2.0');
      expect(response.body.id).toBe('test-id');
    });

    it('should handle different ID types correctly', async () => {
      const testIds = [1, '123', 'test-string', null];

      for (const id of testIds) {
        const response = await request(app)
          .post('/1')
          .send({
            jsonrpc: '2.0',
            method: 'eth_chainId',
            params: [],
            id
          })
          .expect(200);

        expect(response.body.id).toBe(id);
      }
    });
  });
});
