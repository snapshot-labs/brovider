import { NextFunction, Request, Response } from 'express';

export default function handleJsonParseError(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err?.type !== 'entity.parse.failed') return next(err);

  res.status(400).json({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32700, message: 'Parse error' }
  });
}
