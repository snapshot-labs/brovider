import { NextFunction, Request, Response } from 'express';
import subgraphErrorHandler from './subgraphErrorHandler';

function buildRes() {
  const state: { statusCode?: number; body?: any } = {};
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: any) {
      state.body = body;
      return res;
    }
  } as unknown as Response;
  return { res, state };
}

describe('subgraphErrorHandler', () => {
  const req = {} as Request;
  const next = (() => {}) as NextFunction;

  it('uses a valid statusCode as-is', () => {
    const { res, state } = buildRes();
    subgraphErrorHandler(
      { statusCode: 400, message: 'bad request' },
      req,
      res,
      next
    );
    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ errors: [{ message: 'bad request' }] });
  });

  it('falls back to 500 when the only status-like field is not a valid HTTP status code', () => {
    const { res, state } = buildRes();
    const timeoutError = new Error('The operation was aborted due to timeout');
    (timeoutError as any).name = 'TimeoutError';
    (timeoutError as any).code = 23;

    expect(() =>
      subgraphErrorHandler(timeoutError, req, res, next)
    ).not.toThrow();
    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({
      errors: [{ message: 'The operation was aborted due to timeout' }]
    });
  });

  it('falls back to 500 for a non-numeric error code such as a Node system error', () => {
    const { res, state } = buildRes();
    const connError = new Error('connect ECONNREFUSED');
    (connError as any).code = 'ECONNREFUSED';

    expect(() => subgraphErrorHandler(connError, req, res, next)).not.toThrow();
    expect(state.statusCode).toBe(500);
  });
});
