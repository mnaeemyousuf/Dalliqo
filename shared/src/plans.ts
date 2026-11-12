/**
 * Subscription plans and module entitlements — the single source of truth used by the API
 * (enforcement) and the apps (hiding modules a plan does not include).
 */

export const MODULES = ['crm', 'matching', 'deals', 'reports', 'agreements', 'finance', 'branches', 'automation', 'marketing', 'rentals', 'ai', 'api'] as const;
export type Module = (typeof MODULES)[number];

export const PLAN_KEYS = ['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ['MONTHLY', 'ANNUAL'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export interface PlanLimits {
  /** Active members (null = unlimited). */
  users: number | null;
  branches: number | null;
  storageMb: number | null;
}

export interface PlanDefinition {
  key: PlanKey;
  modules: readonly Module[];
  limits: PlanLimits;
  /** List prices in PKR (informational; billing itself happens outside the app). */
  priceMonthly: number;
  priceAnnual: number;
}

const STARTER: Module[] = ['crm', 'matching'];
const PROFESSIONAL: Module[] = [...STARTER, 'deals', 'reports', 'agreements'];
const BUSINESS: Module[] = [...PROFESSIONAL, 'finance', 'branches', 'automation', 'marketing', 'rentals'];
const ENTERPRISE: Module[] = [...BUSINESS, 'ai', 'api'];

export const PLANS: Record<PlanKey, PlanDefinition> = {
  STARTER: { key: 'STARTER', modules: STARTER, limits: { users: 2, branches: 1, storageMb: 2_048 }, priceMonthly: 2_999, priceAnnual: 29_990 },
  PROFESSIONAL: { key: 'PROFESSIONAL', modules: PROFESSIONAL, limits: { users: 10, branches: 1, storageMb: 10_240 }, priceMonthly: 7_999, priceAnnual: 79_990 },
  BUSINESS: { key: 'BUSINESS', modules: BUSINESS, limits: { users: 50, branches: 10, storageMb: 51_200 }, priceMonthly: 19_999, priceAnnual: 199_990 },
  ENTERPRISE: { key: 'ENTERPRISE', modules: ENTERPRISE, limits: { users: null, branches: null, storageMb: null }, priceMonthly: 49_999, priceAnnual: 499_990 },
};

/** New businesses get the full product for this many days. */
export const TRIAL_DAYS = 14;
export const TRIAL_PLAN: PlanKey = 'ENTERPRISE';
/** Days after the paid period ends during which the account stays usable (PAST_DUE). */
export const GRACE_DAYS = 7;

export interface SubscriptionState {
  plan: PlanKey;
  status: SubscriptionStatus;
  cycle?: BillingCycle | null;
  trialEndsAt?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
}

/** Status after applying the clock: trials and paid periods lapse without a background job. */
export function effectiveStatus(s: SubscriptionState, now = Date.now()): SubscriptionStatus {
  if (s.status === 'CANCELLED' || s.status === 'EXPIRED') return s.status;
  if (s.status === 'TRIAL') return s.trialEndsAt && new Date(s.trialEndsAt).getTime() < now ? 'EXPIRED' : 'TRIAL';
  if (s.currentPeriodEnd) {
    const end = new Date(s.currentPeriodEnd).getTime();
    if (end < now) return end + GRACE_DAYS * 86_400_000 < now ? 'EXPIRED' : 'PAST_DUE';
  }
  return s.status;
}

/** Whether the account can still create and change data. */
export const isWritable = (status: SubscriptionStatus) => status === 'TRIAL' || status === 'ACTIVE' || status === 'PAST_DUE';

export function modulesFor(s: SubscriptionState): readonly Module[] {
  return PLANS[s.plan]?.modules ?? STARTER;
}

export function hasModule(s: SubscriptionState, m: Module): boolean {
  return modulesFor(s).includes(m);
}

/** What the apps receive (GET /auth/me and GET /subscription). */
export interface Entitlements {
  plan: PlanKey;
  status: SubscriptionStatus;
  writable: boolean;
  modules: Module[];
  limits: PlanLimits;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
}

export function entitlementsFor(s: SubscriptionState, now = Date.now()): Entitlements {
  const status = effectiveStatus(s, now);
  const iso = (d?: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return {
    plan: s.plan,
    status,
    writable: isWritable(status),
    modules: [...modulesFor(s)],
    limits: PLANS[s.plan]?.limits ?? PLANS.STARTER.limits,
    trialEndsAt: iso(s.trialEndsAt),
    currentPeriodEnd: iso(s.currentPeriodEnd),
  };
}
