import { NextFunction, Request, Response } from 'express';

const GRAPHQL_ROUTES = new RegExp('^/(subgraph|delegation)/', 'i');

const CLIENT_BODY_ERRORS = new Set([
  'entity.parse.failed',
  'entity.too.large',
  'charset.unsupported',
  'encoding.unsupported',
  'parameters.too.many',
  'request.aborted',
  'request.size.invalid'
]);

export default function handleJsonParseError(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!CLIENT_BODY_ERRORS.has(err?.type)) return next(err);

  const status = err.status || 400;
  const isParseError = err.type === 'entity.parse.failed';
  const message = isParseError ? 'Parse error' : err.message;

  if (GRAPHQL_ROUTES.test(req.path)) {
    return res.status(status).json({ errors: [{ message }] });
  }

  res.status(status).json({
    jsonrpc: '2.0',
    id: null,
    error: { code: isParseError ? -32700 : -32600, message }
  });
}
