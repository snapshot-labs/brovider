import { NextFunction, Request, Response } from 'express';

export default function validateJsonRpc(req: Request, res: Response, next: NextFunction) {
  const body = req.body;

  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || body.method === '') {
    const id =
      body && (typeof body.id === 'string' || typeof body.id === 'number' || body.id === null)
        ? body.id
        : null;
    return res.status(400).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request' }
    });
  }

  next();
}
