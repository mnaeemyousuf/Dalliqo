import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ERROR_CODES } from '@recrm/shared';
import { logger } from '../config/logger';
import { TenantGuardError } from '../models/plugins/tenant';
import { AppError } from '../utils/AppError';
import { isDuplicateKeyError } from '../utils/mongoErrors';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ success: false, code: ERROR_CODES.ROUTE_NOT_FOUND, message: `Route ${req.method} ${req.path} not found` });
}

/** Single place errors become HTTP responses. Stack traces are logged, never returned. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Some fields are invalid',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ success: false, code: ERROR_CODES.INVALID_ID, message: `Invalid ${err.path}` });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      success: false,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Some fields are invalid',
      details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    });
    return;
  }

  if (isDuplicateKeyError(err)) {
    res.status(409).json({
      success: false,
      code: ERROR_CODES.DUPLICATE_KEY,
      message: 'A record with these details already exists',
      details: { fields: Object.keys(err.keyPattern ?? {}) },
    });
    return;
  }

  if ((err as { name?: string })?.name === 'MulterError') {
    const m = err as { code: string; message: string };
    const tooLarge = m.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      success: false,
      code: tooLarge ? ERROR_CODES.FILE_TOO_LARGE : ERROR_CODES.INVALID_FILE,
      message: tooLarge ? 'File is too large' : m.message,
    });
    return;
  }

  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ success: false, code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: 'Request body too large' });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ success: false, code: ERROR_CODES.VALIDATION_ERROR, message: 'Malformed JSON body' });
    return;
  }

  if (err instanceof TenantGuardError) {
    // A programming error: a code path tried to query tenant data unscoped.
    logger.fatal({ err, path: req.path }, 'Tenant guard blocked an unscoped query');
  } else {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  }
  res.status(500).json({ success: false, code: ERROR_CODES.INTERNAL_ERROR, message: 'Something went wrong' });
}
