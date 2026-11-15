import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
      details: err.details,
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: err.issues[0]?.message || 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: string }).name === 'MulterError'
  ) {
    const multerErr = err as { code?: string; message?: string };
    const message =
      multerErr.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum upload size is 25 MB.'
        : multerErr.message || 'File upload failed.';
    return res.status(400).json({
      success: false,
      code: multerErr.code || 'UPLOAD_ERROR',
      message,
    });
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: string }).name === 'CastError'
  ) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_ID',
      message: 'Invalid identifier provided.',
    });
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  ) {
    const keyValue = (err as { keyValue?: Record<string, unknown> }).keyValue || {};
    const field = Object.keys(keyValue)[0] || 'field';
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_KEY',
      message: `That ${field} is already in use.`,
    });
  }

  console.error('[API Error]', err);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected server error occurred.',
  });
}
