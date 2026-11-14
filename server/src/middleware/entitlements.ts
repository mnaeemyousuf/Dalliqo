import type { NextFunction, Request, Response } from 'express';
import type { Module } from '@recrm/shared';
import { subscriptionService } from '../services/subscriptionService';
import { unauthorized } from '../utils/AppError';

/**
 * Plan enforcement in one place. Paths map to the module that powers them; a request to a
 * module outside the business's plan gets 403 MODULE_NOT_IN_PLAN. Writes on an expired
 * subscription get 402 SUBSCRIPTION_EXPIRED (reads keep working so no data is ever locked away).
 */
export const MODULE_PREFIXES: [string, Module][] = [
  ['/deals', 'deals'],
  ['/leases', 'rentals'],
  ['/campaigns', 'marketing'],
  ['/ai', 'ai'],
  ['/reports/campaigns', 'marketing'],
  ['/installments', 'finance'],
  ['/reports/cash-flow', 'finance'],
  ['/reports/aging', 'finance'],
  ['/reports/agent-statement', 'deals'],
  ['/reports/commissions', 'deals'],
  ['/agreements', 'agreements'],
  ['/agreement-templates', 'agreements'],
  ['/transactions', 'finance'],
  ['/transaction-categories', 'finance'],
  ['/reports/finance', 'finance'],
  ['/reports', 'reports'],
  ['/exports', 'reports'],
  ['/dashboard/analytics', 'reports'],
];

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function entitlementGuard(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) return next(unauthorized());
  // Mounted on several prefixes, so use the full URL path (without the /api prefix and query).
  const path = req.originalUrl.split('?')[0].replace(/^\/api(?=\/)/, '');
  const modules = MODULE_PREFIXES.filter(([p]) => matches(path, p)).map(([, m]) => m);
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  // Marking notifications read and registering devices stay possible on an expired account.
  const writeExempt = path.startsWith('/notifications') || path.startsWith('/devices');
  (async () => {
    for (const m of new Set(modules)) await subscriptionService.assertModule(auth, m);
    if (write && !writeExempt) await subscriptionService.assertWritable(auth);
  })().then(() => next(), next);
}

/** Route-level guard for modules not covered by a path prefix. */
export const requireModule = (module: Module) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(unauthorized());
  subscriptionService.assertModule(req.auth, module).then(() => next(), next);
};
