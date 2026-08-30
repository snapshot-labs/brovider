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

  it.each([
    { type: 'entity.too.large', status: 413, message: 'request entity too large' },
    { type: 'charset.unsupported', status: 415, message: 'unsupported charset "FOO"' },
    { type: 'encoding.unsupported', status: 415, message: 'unsupported content encoding "foo"' },
    { type: 'parameters.too.many', status: 413, message: 'too many parameters' },
    { type: 'request.aborted', status: 400, message: 'request aborted' },
    {
      type: 'request.size.invalid',
      status: 400,
      message: 'request size did not match content length'
    }
  ])('answers a JSON-RPC -32600 for $type', ({ type, status, message }) => {
    const err = Object.assign(new Error(message), { type, status });

    const { status: statusMock, json, next } = run(err);

    expect(statusMock).toHaveBeenCalledWith(status);
    expect(json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message }
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('answers a GraphQL-shaped error for a non-parse client body error on a GraphQL route', () => {
    const err = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413
    });

    const { status, json, next } = run(err, '/subgraph/1/space');

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({ errors: [{ message: 'request entity too large' }] });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes through a 500-class body-parser programmer error unanswered', () => {
    const err = Object.assign(new Error('stream is not readable'), {
      type: 'stream.not.readable'
    });

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
