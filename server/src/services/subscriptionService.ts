import { Types } from 'mongoose';
import {
  ERROR_CODES,
  PLANS,
  TRIAL_DAYS,
  TRIAL_PLAN,
  entitlementsFor,
  hasModule,
  type BillingCycle,
  type Entitlements,
  type Module,
  type PlanKey,
  type SubscriptionState,
  type SubscriptionStatus,
} from '@recrm/shared';
import { env } from '../config/env';
import { Branch } from '../models/Branch';
import { Business, type BusinessDoc, type SubscriptionDoc } from '../models/Business';
import { BusinessMember } from '../models/BusinessMember';
import { Document as DocumentAsset, PropertyMedia } from '../models/FileAsset';
import { User } from '../models/User';
import type { AuthContext, TenantContext } from '../types/context';
import { AppError, forbidden, notFound } from '../utils/AppError';
import { auditService } from './auditService';
import { notificationService } from './notificationService';

/**
 * Subscription plans and module entitlements, enforced centrally:
 *  - requireModule() guards whole route groups (see routes/crmRoutes.ts),
 *  - the write guard makes an expired account read-only,
 *  - assertLimit() is called where users, branches and files are added.
 * Billing itself (card / bank collection) happens outside the app; a platform admin records
 * payments and plan changes, which is what activates or renews a subscription.
 */

/** Businesses created before plans existed run on the full product until a plan is set. */
const LEGACY: SubscriptionState = { plan: 'ENTERPRISE', status: 'ACTIVE' };

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; state: SubscriptionState }>();

function stateOf(b: Pick<BusinessDoc, 'subscription'> | null): SubscriptionState {
  const s = b?.subscription;
  if (!s?.plan || !s?.status) return LEGACY;
  return { plan: s.plan, status: s.status, cycle: s.cycle, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd };
}

export const subscriptionService = {
  /** Subscription of a new business: a full-featured trial. */
  newTrial(now = new Date()): SubscriptionDoc {
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
    return {
      plan: TRIAL_PLAN,
      status: 'TRIAL',
      cycle: null,
      trialEndsAt,
      currentPeriodEnd: null,
      history: [{ _id: new Types.ObjectId(), type: 'TRIAL_STARTED', plan: TRIAL_PLAN, periodEnd: trialEndsAt, at: now }],
    };
  },

  async state(businessId: string): Promise<SubscriptionState> {
    const hit = cache.get(businessId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
    const state = stateOf(await Business.findById(businessId).select('subscription').lean<BusinessDoc>());
    cache.set(businessId, { at: Date.now(), state });
    return state;
  },

  forget(businessId: string) {
    cache.delete(businessId);
  },

  async entitlements(ctx: TenantContext): Promise<Entitlements> {
    return entitlementsFor(await this.state(ctx.businessId));
  },

  async assertModule(ctx: TenantContext, module: Module) {
    const state = await this.state(ctx.businessId);
    if (!hasModule(state, module)) {
      throw new AppError(403, ERROR_CODES.MODULE_NOT_IN_PLAN, `This feature is not included in your ${state.plan} plan`, { module, plan: state.plan });
    }
  },

  async assertWritable(ctx: TenantContext) {
    const e = await this.entitlements(ctx);
    if (!e.writable) {
      throw new AppError(402, ERROR_CODES.SUBSCRIPTION_EXPIRED, 'Your subscription has ended. Renew it to add or change records — your data is safe and still readable.', {
        status: e.status,
      });
    }
  },

  async usage(ctx: TenantContext) {
    const bid = new Types.ObjectId(ctx.businessId);
    const bytes = (m: typeof PropertyMedia) =>
      m.aggregate<{ bytes: number }>([{ $match: { businessId: bid, deletedAt: null } }, { $group: { _id: null, bytes: { $sum: '$fileSize' } } }]).option({ skipTenantGuard: true } as never);
    const [users, branches, media, docs] = await Promise.all([
      BusinessMember.countDocuments({ businessId: bid, status: 'ACTIVE' }).setOptions({ skipTenantGuard: true } as never),
      Branch.countDocuments({ businessId: bid, archivedAt: null, deletedAt: null }).setOptions({ skipTenantGuard: true } as never),
      bytes(PropertyMedia),
      bytes(DocumentAsset),
    ]);
    const total = (media[0]?.bytes ?? 0) + (docs[0]?.bytes ?? 0);
    return { users, branches, storageMb: Math.round((total / 1_048_576) * 10) / 10 };
  },

  /** Throws PLAN_LIMIT_REACHED when adding `adding` more would exceed the plan. */
  async assertLimit(ctx: TenantContext, kind: 'users' | 'branches' | 'storageMb', adding = 1) {
    const e = await this.entitlements(ctx);
    const limit = e.limits[kind];
    if (limit === null) return;
    const used = (await this.usage(ctx))[kind];
    if (used + adding > limit) {
      const what = { users: 'users', branches: 'branches', storageMb: 'MB of storage' }[kind];
      throw new AppError(403, ERROR_CODES.PLAN_LIMIT_REACHED, `Your ${e.plan} plan allows ${limit} ${what}. Upgrade to add more.`, { kind, limit, used });
    }
  },

  async get(ctx: TenantContext) {
    const business = await Business.findById(ctx.businessId).select('subscription').lean<BusinessDoc>();
    return {
      ...entitlementsFor(stateOf(business)),
      cycle: business?.subscription?.cycle ?? null,
      usage: await this.usage(ctx),
      history: [...(business?.subscription?.history ?? [])].reverse().slice(0, 50),
      plans: PLANS,
    };
  },

  /** The owner asks for a plan; a platform admin activates it once paid. */
  async requestChange(auth: AuthContext, plan: PlanKey, cycle: BillingCycle, note?: string) {
    await Business.updateOne(
      { _id: auth.businessId },
      { $push: { 'subscription.history': { _id: new Types.ObjectId(), type: 'UPGRADE_REQUESTED', plan, cycle, note: note ?? null, by: auth.userId, at: new Date() } } },
    );
    await auditService.record(auth, { action: 'subscription.change_requested', entityType: 'business', entityId: new Types.ObjectId(auth.businessId), changes: [{ field: 'plan', oldValue: null, newValue: `${plan} (${cycle})` }] });
    return this.get(auth);
  },

  // ── Platform administration (Stateown staff; PLATFORM_ADMIN_EMAILS) ──

  async isPlatformAdmin(userId: string): Promise<boolean> {
    const admins = (env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!admins.length) return false;
    const user = await User.findById(userId).select('email').lean<{ email: string }>();
    return !!user && admins.includes(user.email.toLowerCase());
  },

  async assertPlatformAdmin(userId: string) {
    if (!(await this.isPlatformAdmin(userId))) throw forbidden(ERROR_CODES.FORBIDDEN, 'Platform administrators only');
  },

  async listBusinesses(q: { q?: string; page: number; limit: number }) {
    const filter: Record<string, unknown> = q.q ? { name: new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } : {};
    const [items, total] = await Promise.all([
      Business.find(filter).select('name city status subscription.plan subscription.status subscription.trialEndsAt subscription.currentPeriodEnd subscription.cycle createdAt').sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean<BusinessDoc[]>(),
      Business.countDocuments(filter),
    ]);
    return {
      items: items.map((b) => ({ _id: b._id, name: b.name, city: b.city, createdAt: b.createdAt, ...entitlementsFor(stateOf(b)), cycle: b.subscription?.cycle ?? null })),
      total,
    };
  },

  /** Activates / renews / changes a business's plan and records the payment. */
  async setSubscription(
    admin: AuthContext,
    businessId: string,
    input: { plan: PlanKey; status: SubscriptionStatus; cycle?: BillingCycle | null; currentPeriodEnd?: Date | null; trialEndsAt?: Date | null; amount?: number | null; reference?: string | null; note?: string | null },
  ) {
    const business = await Business.findById(businessId).lean<BusinessDoc>();
    if (!business) throw notFound(ERROR_CODES.BUSINESS_NOT_FOUND, 'Business not found');
    const before = stateOf(business);
    const now = new Date();
    const event = {
      _id: new Types.ObjectId(),
      type: input.amount ? ('PAYMENT_RECORDED' as const) : input.status === 'CANCELLED' ? ('CANCELLED' as const) : ('PLAN_CHANGED' as const),
      plan: input.plan,
      cycle: input.cycle ?? null,
      amount: input.amount ?? null,
      reference: input.reference ?? null,
      note: input.note ?? null,
      periodEnd: input.currentPeriodEnd ?? input.trialEndsAt ?? null,
      by: new Types.ObjectId(admin.userId),
      at: now,
    };
    await Business.updateOne(
      { _id: businessId },
      {
        $set: {
          'subscription.plan': input.plan,
          'subscription.status': input.status,
          'subscription.cycle': input.cycle ?? null,
          'subscription.currentPeriodEnd': input.currentPeriodEnd ?? null,
          ...(input.trialEndsAt !== undefined ? { 'subscription.trialEndsAt': input.trialEndsAt } : {}),
        },
        $push: { 'subscription.history': event },
      },
    );
    this.forget(businessId);
    const ctx = { businessId, userId: admin.userId };
    await auditService.record(ctx, {
      action: 'subscription.updated',
      entityType: 'business',
      entityId: new Types.ObjectId(businessId),
      entityLabel: business.name,
      changes: [
        { field: 'plan', oldValue: before.plan, newValue: input.plan },
        { field: 'status', oldValue: before.status, newValue: input.status },
      ],
    });
    const owners = await BusinessMember.find({ businessId, role: 'OWNER', status: 'ACTIVE' }).select('userId').lean<{ userId: Types.ObjectId }[]>();
    const ownerIds = owners.length ? owners.map((m) => m.userId.toString()) : [String(business.ownerUserId)];
    await notificationService.notify(ctx, {
      userIds: ownerIds,
      category: 'SYSTEM',
      title: 'Subscription updated',
      body: `Your plan is now ${input.plan} (${input.status.toLowerCase()})${input.currentPeriodEnd ? ` until ${input.currentPeriodEnd.toISOString().slice(0, 10)}` : ''}.`,
      deepLink: '/settings?tab=subscription',
    });
    return entitlementsFor(stateOf(await Business.findById(businessId).lean<BusinessDoc>()));
  },
};
