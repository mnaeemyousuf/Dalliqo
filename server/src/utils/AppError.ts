import { ERROR_CODES, type ErrorCode } from '@recrm/shared';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: ErrorCode, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (code: ErrorCode = ERROR_CODES.UNAUTHENTICATED, message = 'Authentication required') =>
  new AppError(401, code, message);
export const forbidden = (code: ErrorCode = ERROR_CODES.FORBIDDEN, message = 'You do not have permission to do this') =>
  new AppError(403, code, message);
export const notFound = (code: ErrorCode = ERROR_CODES.NOT_FOUND, message = 'Resource not found') =>
  new AppError(404, code, message);
export const conflict = (code: ErrorCode, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
