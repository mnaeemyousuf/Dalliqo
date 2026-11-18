import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@recrm/shared';
import { BRANCH_HEADER } from '@recrm/shared';
import { apiKeyService, isApiKey } from '../services/apiKeyService';
import { resolveAuthContext } from '../services/authContextService';
import { narrowToSelectedBranch } from '../services/branchScope';
import { regionService } from '../services/regionService';
import { withCurrency } from '../utils/text';
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
  if (isApiKey(token)) {
    // API access keys (Enterprise): limited permissions, record endpoints only.
    const path = req.originalUrl.split('?')[0].replace(/^\/api(?=\/)/, '');
    req.auth = await narrowToSelectedBranch(await apiKeyService.resolve(token, path), req.get(BRANCH_HEADER));
  } else {
    req.auth = await narrowToSelectedBranch(await resolveAuthContext(tokenService.verifyAccessToken(token)), req.get(BRANCH_HEADER));
  }
  // Amounts in messages, PDFs and exports use the business's own currency for the rest of the request.
  const { currency } = await regionService.of(req.auth.businessId);
  withCurrency(currency, () => next());
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
