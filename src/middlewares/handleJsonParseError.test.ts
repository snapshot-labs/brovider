import { NextFunction, Request, Response } from 'express';
import handleJsonParseError from './handleJsonParseError';

function run(err: any, path = '/1') {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const next = jest.fn();
  const res = { status } as unknown as Response;

  handleJsonParseError(err, { path } as Request, res, next as NextFunction);

  return { status, json, next };
}

describe('handleJsonParseError', () => {
  it('answers a JSON-RPC parse error for a body-parser JSON parse failure', () => {
    const err = Object.assign(new SyntaxError('Unexpected end of JSON input'), {
      type: 'entity.parse.failed'
    });

    const { status, json, next } = run(err);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' }
    });
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['/subgraph/1/space', '/delegation/1', '/SUBGRAPH/1/space', '/Delegation/1'])(
    'answers a GraphQL-shaped parse error for %s',
    path => {
      const err = Object.assign(new SyntaxError('Unexpected end of JSON input'), {
        type: 'entity.parse.failed'
      });

      const { status, json, next } = run(err, path);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ errors: [{ message: 'Parse error' }] });
      expect(next).not.toHaveBeenCalled();
    }
  );

  it.each(['/1', '/137', '/sn', '/', '/subgraph'])(
    'answers a JSON-RPC-shaped parse error for %s',
    path => {
      const err = Object.assign(new SyntaxError('Unexpected end of JSON input'), {
        type: 'entity.parse.failed'
      });

      const { status, json } = run(err, path);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      });
    }
  );

  it('passes through any other error unanswered', () => {
    const err = Object.assign(new Error('payload too large'), { type: 'entity.too.large' });

    const { status, next } = run(err);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
  });

  it('passes through a syntax error carrying no body-parser marker', () => {
    const err = new SyntaxError('unrelated syntax error');

    const { status, next } = run(err);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
  });
});
