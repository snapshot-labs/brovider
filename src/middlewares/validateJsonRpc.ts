import { NextFunction, Request, Response } from 'express';
import { sanitizeId } from '../helpers/jsonrpc';

export default function validateJsonRpc(req: Request, res: Response, next: NextFunction) {
  const body = req.body;

  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || body.method === '') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: sanitizeId(body),
      error: { code: -32600, message: 'Invalid Request' }
    });
  }

  next();
}
