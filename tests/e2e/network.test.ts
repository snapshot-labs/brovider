import { Server } from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { rpcRequestCount, rpcUnknownMethodCount } from '../../src/helpers/metrics';
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
    const configuredNetworks = ['1', '10', 'sn', 'sn-sep', '0x1'];
    let configuredNodes: Record<string, string>;
    let originalNodes: Record<string, string | undefined>;
    let upstream: Server;
    let upstreamBodies: unknown[] = [];

    beforeAll(async () => {
      stop();
      const upstreamApp = express();
      upstreamApp.use(express.json());
      upstreamApp.post('/', (req, res) => {
        upstreamBodies.push(req.body);

        const getResponse = (body: { jsonrpc: unknown; id: unknown; method: string }) => ({
          jsonrpc: body.jsonrpc,
          id: body.id,
          result:
            body.method === 'eth_chainId' || body.method === 'starknet_chainId'
              ? 'upstream-chain-id'
              : `upstream-${body.method}`
        });

        if (Array.isArray(req.body)) {
          return res.json(
            req.body
              .filter(item => Object.hasOwn(item, 'id'))
              .map(getResponse)
              .reverse()
          );
        }

        if (!Object.hasOwn(req.body, 'id')) {
          return res.status(204).end();
        }

        return res.json(getResponse(req.body));
      });
      upstream = await new Promise(resolve => {
        const server = upstreamApp.listen(0, '127.0.0.1', () => resolve(server));
      });
      const { port } = upstream.address() as AddressInfo;
      const upstreamUrl = `http://127.0.0.1:${port}`;
      configuredNodes = nodes as Record<string, string>;
      originalNodes = Object.fromEntries(
        configuredNetworks.map(network => [network, configuredNodes[network]])
      );
      for (const network of configuredNetworks) {
        configuredNodes[network] = upstreamUrl;
      }
    });

    beforeEach(() => {
      upstreamBodies = [];
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
        expect(upstreamBodies).toHaveLength(0);
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
        expect(upstreamBodies).toEqual([body]);
      });

      it('should proxy a valid request for a non-decimal network', async () => {
        const body = {
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 3
        };

        const response = await request(app).post('/sn').send(body).expect(200);

        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 3,
          result: 'upstream-chain-id'
        });
        expect(upstreamBodies).toEqual([body]);
      });

      it('should answer a valid request without params locally', async () => {
        const response = await request(app)
          .post('/1')
          .send({
            jsonrpc: '2.0',
            method: 'eth_chainId',
            id: 3
          })
          .expect(200);

        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 3,
          result: '0x1'
        });
        expect(upstreamBodies).toHaveLength(0);
      });

      it.each([
        {
          type: 'string params',
          body: { jsonrpc: '2.0', method: 'eth_chainId', params: 'bad', id: 3 }
        },
        {
          type: 'boolean ID',
          body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: false }
        }
      ])('should proxy a request with $type', async ({ body }) => {
        const response = await request(app).post('/1').send(body).expect(200);

        expect(upstreamBodies).toEqual([body]);
        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: body.id,
          result: 'upstream-chain-id'
        });
      });

      it('should proxy a notification without returning a local response', async () => {
        const body = {
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: []
        };

        await request(app).post('/1').send(body).expect(204);

        expect(upstreamBodies).toEqual([body]);
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
          expect(upstreamBodies).toHaveLength(0);
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
        expect(upstreamBodies).toEqual([body]);
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
          result: 'upstream-starknet_blockNumber'
        });
        expect(upstreamBodies).toEqual([body]);
      });

      it('should reject a starknet_chainId request missing jsonrpc rather than answer it locally', async () => {
        const body = { method: 'starknet_chainId', id: 6 };
        const response = await request(app).post('/sn').send(body).expect(400);

        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 6,
          error: { code: -32600, message: 'Invalid Request' }
        });
        expect(upstreamBodies).toHaveLength(0);
      });

      it('should proxy a starknet_chainId request with non-empty params rather than answer it locally', async () => {
        const body = { jsonrpc: '2.0', method: 'starknet_chainId', params: ['bad'], id: 7 };
        const response = await request(app).post('/sn').send(body).expect(200);

        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 7,
          result: 'upstream-chain-id'
        });
        expect(upstreamBodies).toEqual([body]);
      });

      it('should proxy a starknet_chainId notification (no id) rather than answer it locally', async () => {
        const body = { jsonrpc: '2.0', method: 'starknet_chainId', params: [] };
        await request(app).post('/sn').send(body);

        expect(upstreamBodies).toEqual([body]);
      });
    });

    it('should keep forwarding valid single requests unchanged', async () => {
      const body = {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 'single'
      };

      const response = await request(app).post('/1').send(body).expect(200);

      expect(upstreamBodies).toEqual([body]);
      expect(response.body).toEqual({
        jsonrpc: '2.0',
        id: 'single',
        result: 'upstream-eth_blockNumber'
      });
    });

    describe('Request Validation Errors', () => {
      it('should return a JSON-RPC error for a missing request body', async () => {
        const response = await request(app).post('/1').expect(400);

        expect(upstreamBodies).toHaveLength(0);
        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Invalid Request'
          }
        });
      });

      it('should reject an array body', async () => {
        const response = await request(app)
          .post('/1')
          .send([{ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }])
          .expect(400);

        expect(upstreamBodies).toHaveLength(0);
        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Invalid Request'
          }
        });
      });

      it.each([
        { type: 'a missing method', body: { jsonrpc: '2.0', params: [], id: 2 } },
        { type: 'a non-string method', body: { jsonrpc: '2.0', method: 42, params: [], id: 2 } },
        { type: 'an empty method', body: { jsonrpc: '2.0', method: '', params: [], id: 2 } }
      ])('should reject a request with $type', async ({ body }) => {
        const response = await request(app).post('/1').send(body).expect(400);

        expect(upstreamBodies).toHaveLength(0);
        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 2,
          error: {
            code: -32600,
            message: 'Invalid Request'
          }
        });
      });

      it('should preserve the ID of an invalid single chain ID request', async () => {
        const response = await request(app)
          .post('/1')
          .send({
            jsonrpc: '1.0',
            method: 'eth_chainId',
            params: [],
            id: 'invalid-version'
          })
          .expect(400);

        expect(upstreamBodies).toHaveLength(0);
        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 'invalid-version',
          error: {
            code: -32600,
            message: 'Invalid Request'
          }
        });
      });
    });

    describe('Unknown Methods', () => {
      const collectUnknownCounts = async () =>
        (await rpcUnknownMethodCount.get()).values
          .map(({ labels, value }) => ({ ...labels, value }))
          .sort((a, b) => String(a.namespace).localeCompare(String(b.namespace)));

      beforeEach(() => {
        rpcUnknownMethodCount.reset();
      });

      it.each([
        { type: 'a namespace a node serves', method: 'erigon_blockNumber', namespace: 'erigon' },
        { type: 'a namespace no node serves', method: 'foobar_x', namespace: 'other' },
        { type: 'a method name with no namespace', method: 'foobar', namespace: 'other' }
      ])('should proxy $type and count it', async ({ method, namespace }) => {
        const body = { jsonrpc: '2.0', method, params: [], id: 1 };

        await request(app).post('/1').send(body).expect(200);

        expect(upstreamBodies).toEqual([body]);
        expect(await collectUnknownCounts()).toEqual([{ namespace, value: 1 }]);
      });

      it.each([
        { method: 'chain_getBlockHash' },
        { method: 'state_getStorage' },
        { method: 'hmyv2_getValidatorsStakeByBlockNumber' }
      ])('should not count $method, which a score-api strategy sends', async ({ method }) => {
        await request(app)
          .post('/1')
          .send({ jsonrpc: '2.0', method, params: [], id: 1 })
          .expect(200);

        expect(upstreamBodies).toHaveLength(1);
        expect(await collectUnknownCounts()).toEqual([]);
      });
    });
    describe('Request Metrics', () => {
      const collectCounts = async () =>
        (await rpcRequestCount.get()).values
          .map(({ labels, value }) => ({ ...labels, value }))
          .sort((a, b) => String(a.rpc_method).localeCompare(String(b.rpc_method)));

      beforeEach(() => {
        rpcRequestCount.reset();
      });

      it('should count a proxied request by network, client and method', async () => {
        await request(app)
          .post('/1?client=ui')
          .send({ jsonrpc: '2.0', method: 'eth_call', params: [], id: 1 })
          .expect(200);

        expect(await collectCounts()).toEqual([
          { network: '1', client: 'ui', rpc_method: 'eth_call', value: 1 }
        ]);
      });

      it.each(['blockfinder', 'score-api', 'snapshot-relayer', 'stamp'])(
        'should count %s as a recognized client',
        async client => {
          await request(app)
            .post(`/1?client=${client}`)
            .send({ jsonrpc: '2.0', method: 'eth_call', params: [], id: 1 })
            .expect(200);

          expect(await collectCounts()).toEqual([
            { network: '1', client, rpc_method: 'eth_call', value: 1 }
          ]);
        }
      );

      it.each([
        { type: 'an unknown client', path: '/1?client=unknown-app' },
        { type: 'a repeated client', path: '/1?client=ui&client=api' }
      ])('should label $type as other', async ({ path }) => {
        await request(app)
          .post(path)
          .send({ jsonrpc: '2.0', method: 'eth_call', params: [], id: 1 })
          .expect(200);

        expect(await collectCounts()).toEqual([
          { network: '1', client: 'other', rpc_method: 'eth_call', value: 1 }
        ]);
      });

      it('should label a missing client as none', async () => {
        await request(app)
          .post('/1')
          .send({ jsonrpc: '2.0', method: 'eth_call', params: [], id: 1 })
          .expect(200);

        expect(await collectCounts()).toEqual([
          { network: '1', client: 'none', rpc_method: 'eth_call', value: 1 }
        ]);
      });

      it('should label an unknown method as other', async () => {
        await request(app)
          .post('/1?client=ui')
          .send({ jsonrpc: '2.0', method: 'eth_notAMethod', params: [], id: 1 })
          .expect(200);

        expect(await collectCounts()).toEqual([
          { network: '1', client: 'ui', rpc_method: 'other', value: 1 }
        ]);
      });

      it.each([
        {
          type: 'a request answered locally',
          path: '/1?client=ui',
          body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 },
          status: 200
        },
        {
          type: 'an unknown network',
          path: '/999999?client=ui',
          body: { jsonrpc: '2.0', method: 'eth_call', params: [], id: 1 },
          status: 404
        },
        {
          type: 'an invalid request',
          path: '/1?client=ui',
          body: { method: 'eth_call', params: [], id: 1 },
          status: 400
        },
        {
          type: 'an unusable node URL',
          path: '/11001100?client=ui',
          body: { jsonrpc: '2.0', method: 'eth_call', params: [], id: 1 },
          status: 500
        }
      ])('should not count $type', async ({ path, body, status }) => {
        await request(app).post(path).send(body).expect(status);

        expect(await collectCounts()).toEqual([]);
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
