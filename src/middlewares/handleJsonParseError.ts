import { NextFunction, Request, Response } from 'express';

const GRAPHQL_ROUTES = new RegExp('^/(subgraph|delegation)/', 'i');

export default function handleJsonParseError(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err?.type !== 'entity.parse.failed') return next(err);

  if (GRAPHQL_ROUTES.test(req.path)) {
    return res.status(400).json({ errors: [{ message: 'Parse error' }] });
  }

  res.status(400).json({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32700, message: 'Parse error' }
  });
}
