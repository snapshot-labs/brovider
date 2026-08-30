import { NextFunction, Request, Response } from 'express';

const GRAPHQL_ROUTES = new RegExp('^/(subgraph|delegation)/', 'i');

export default function handleJsonParseError(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const status = err?.status ?? 500;
  if (err?.expose !== true || status < 400 || status >= 500) return next(err);

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
