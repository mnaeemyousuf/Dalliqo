import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@recrm/shared';
import { tenantService } from '../services/tenantService';
import { AppError } from '../utils/AppError';

/**
 * SaaS mode: works out which agency a request is for from its Host (agency.<base domain>).
 * An unknown subdomain gets 404 TENANT_NOT_FOUND on the API (except the health check and the
 * tenant lookup the sign-in page uses); the web app then shows "agency not found".
 */
export function resolveTenant(req: Request, _res: Response, next: NextFunction): void {
  const sub = tenantService.subdomainOf(req.hostname);
  if (!sub) return next();
  tenantService
    .bySubdomain(sub)
    .then((tenant) => {
      if (tenant) req.tenant = tenant;
      else if (!/^\/api\/(health|public\/tenant)\b/.test(req.path) && req.path.startsWith('/api')) {
        throw new AppError(404, ERROR_CODES.TENANT_NOT_FOUND, 'No agency uses this address');
      }
      next();
    })
    .catch(next);
}

/** Signed-in requests on an agency's subdomain must belong to that agency. */
export function assertTenantMatch(req: Request, businessId: string): void {
  if (req.tenant && req.tenant.businessId !== businessId) {
    throw new AppError(401, ERROR_CODES.WRONG_TENANT, 'This account belongs to another agency. Sign in at your agency’s own address.');
  }
}
