import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@recrm/shared';
import { resolveAuthContext } from '../services/authContextService';
import { tokenService } from '../services/tokenService';
import type { AuthContext } from '../types/context';
import { forbidden, unauthorized } from '../utils/AppError';
import { asyncHandler } from '../utils/http';

export function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

/** Verifies the access token and loads live membership/permissions into req.auth. */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw unauthorized();
  req.auth = await resolveAuthContext(tokenService.verifyAccessToken(token));
  next();
});

/**
 * Members created by an owner get a temporary password. Until they replace it,
 * only the auth endpoints needed to do so are reachable.
 */
export function requirePasswordCurrent(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.mustChangePassword) {
    next(forbidden(ERROR_CODES.PASSWORD_CHANGE_REQUIRED, 'You must change your temporary password first'));
    return;
  }
  next();
}

/** Narrowing helper for controllers mounted behind `authenticate`. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
