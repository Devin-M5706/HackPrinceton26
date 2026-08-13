/**
 * Error types and the async route wrapper.
 *
 * Express 4 does not catch rejected promises from async handlers: an `await`
 * that throws leaves the request hanging until the client times out and
 * surfaces as an `unhandledRejection` on the process. Every async handler in
 * this codebase is therefore wrapped in `asyncHandler`, which forwards
 * rejections to the central error middleware.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * An error with an intended HTTP status. `message` is sent to the client, so it
 * must never contain internal detail; put that in `meta`, which is logged only.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly meta?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.meta = meta;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, meta?: Record<string, unknown>) =>
  new AppError(400, 'bad_request', message, meta);

export const unauthorized = (message = 'Unauthorized') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'Forbidden') =>
  new AppError(403, 'forbidden', message);

export const notFound = (message = 'Not found') =>
  new AppError(404, 'not_found', message);

export const payloadTooLarge = (message: string) =>
  new AppError(413, 'payload_too_large', message);

export const serviceUnavailable = (message: string, meta?: Record<string, unknown>) =>
  new AppError(503, 'service_unavailable', message, meta);

/**
 * Wrap an async handler so rejections reach the error middleware.
 *
 * Usage: `router.get('/', asyncHandler(async (req, res) => { ... }))`
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
