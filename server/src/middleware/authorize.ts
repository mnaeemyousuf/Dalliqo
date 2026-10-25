import type { NextFunction, Request, Response } from 'express';
import type { Permission } from '@recrm/shared';
import { forbidden, unauthorized } from '../utils/AppError';

/** Requires every listed permission. */
export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorized());
    const missing = required.filter((p) => !req.auth!.permissions.includes(p));
    if (missing.length) return next(forbidden());
    next();
  };
}
