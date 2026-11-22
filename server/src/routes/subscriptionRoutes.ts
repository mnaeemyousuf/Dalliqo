import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { BILLING_CYCLES, PERMISSIONS, PLAN_KEYS, SUBSCRIPTION_STATUSES } from '@recrm/shared';
import { authOf } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { subscriptionService } from '../services/subscriptionService';
import { asyncHandler as h, pageMeta, sendSuccess } from '../utils/http';
import { idParams, pagination } from '../validators/common';

/** /subscription — the business's own plan, usage and billing history. */
export const subscriptionRoutes = Router();

const requestSchema = z.object({ plan: z.enum(PLAN_KEYS), cycle: z.enum(BILLING_CYCLES), note: z.string().trim().max(500).optional() }).strict();

subscriptionRoutes.get(
  '/',
  h(async (req: Request, res: Response) => sendSuccess(res, await subscriptionService.get(authOf(req)))),
);
subscriptionRoutes.post(
  '/request',
  requirePermission(PERMISSIONS.BUSINESS_MANAGE),
  validate({ body: requestSchema }),
  h(async (req: Request, res: Response) => {
    sendSuccess(res, await subscriptionService.requestChange(authOf(req), req.body.plan, req.body.cycle, req.body.note), { message: 'Plan change requested' });
  }),
);

/** /platform — Stateown staff (PLATFORM_ADMIN_EMAILS) manage every business's subscription. */
export const platformRoutes = Router();

platformRoutes.use(
  h(async (req: Request, _res: Response, next) => {
    await subscriptionService.assertPlatformAdmin(authOf(req).userId);
    next();
  }),
);

platformRoutes.get(
  '/businesses',
  validate({ query: pagination.extend({ q: z.string().trim().max(100).optional() }) }),
  h(async (req: Request, res: Response) => {
    const q = req.query as unknown as { q?: string; page: number; limit: number };
    const { items, total } = await subscriptionService.listBusinesses(q);
    sendSuccess(res, items, { meta: pageMeta(q.page, q.limit, total) });
  }),
);

const setSchema = z
  .object({
    plan: z.enum(PLAN_KEYS),
    status: z.enum(SUBSCRIPTION_STATUSES),
    cycle: z.enum(BILLING_CYCLES).nullable().optional(),
    currentPeriodEnd: z.coerce.date().nullable().optional(),
    trialEndsAt: z.coerce.date().nullable().optional(),
    amount: z.number().int().min(0).max(1e9).nullable().optional(),
    reference: z.string().trim().max(120).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

platformRoutes.patch(
  '/businesses/:id/subdomain',
  validate({ params: idParams, body: z.object({ subdomain: z.string().trim().toLowerCase().min(3).max(30) }).strict() }),
  h(async (req: Request, res: Response) => {
    sendSuccess(res, await subscriptionService.setSubdomain(authOf(req), req.params.id, req.body.subdomain), { message: 'Address updated' });
  }),
);

platformRoutes.patch(
  '/businesses/:id/subscription',
  validate({ params: idParams, body: setSchema }),
  h(async (req: Request, res: Response) => {
    sendSuccess(res, await subscriptionService.setSubscription(authOf(req), req.params.id, req.body), { message: 'Subscription updated' });
  }),
);
