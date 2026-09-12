import { NextFunction, Request, Response } from 'express';

function asHttpStatusCode(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

export default function subgraphErrorHandler(
  error: any,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  const statusCode = asHttpStatusCode(error?.statusCode) ?? 500;
  const errorResponse = error?.errors
    ? { errors: error.errors }
    : { errors: [{ message: error.message || error }] };

  return res.status(statusCode).json(errorResponse);
}
