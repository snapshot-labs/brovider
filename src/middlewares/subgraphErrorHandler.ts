import { NextFunction, Request, Response } from 'express';

export default function subgraphErrorHandler(
  error: any,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  const statusCode = error.statusCode || error.code || 500;
  const errorResponse = error?.errors
    ? { errors: error.errors }
    : { errors: [{ message: error.message || error }] };

  return res.status(statusCode).json(errorResponse);
}
