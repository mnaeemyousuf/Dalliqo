import { Types } from 'mongoose';
import { hasModule, type AutomationSettings } from '@recrm/shared';
import { logger } from '../config/logger';
import { Agreement } from '../models/Agreement';
import { Business, type BusinessDoc } from '../models/Business';
import { BusinessMember } from '../models/BusinessMember';
import { Client, type ClientDoc } from '../models/Client';
import { Deal, type DealDoc } from '../models/Deal';
import { Document as DocumentAsset } from '../models/FileAsset';
import { Lease, type LeaseDoc } from '../models/Lease';
import { Property, type PropertyDoc } from '../models/Property';
import type { TenantContext } from '../types/context';
import { activityService } from './activityService';
import { leadService } from './leadService';
import { matchingService } from './matching/matchingService';
import { notificationService } from './notificationService';
import { settingsService } from './settingsService';
import { subscriptionService } from './subscriptionService';

/**
 * Evaluates the configurable automation rules for every active business and notifies the right
 * people. Each alert carries a de-duplication key so a rule fires once per record and situation,
 * not on every run. Runs from the scheduler (one instance at a time, see jobs/scheduler.ts).
 */

const MIN = 60_000;
const DAY = 86_400_000;
const LIMIT = 200;
const skip = { skipTenantGuard: true } as never;

type Alert = { userIds: string[]; title: string; body: string; deepLink: string; key: string; category: 'LEAD' | 'PROPERTY' | 'DEAL' | 'AUTOMATION' };

async function managerIds(businessId: string): Promise<string[]> {
  const rows = await BusinessMember.find({
    businessId,
    status: 'ACTIVE',
    $or: [{ role: { $in: ['OWNER', 'ADMIN', 'MANAGER'] } }, { permissions: 'members:manage' }],
  })
    .select('userId')
    .setOptions(skip)
    .lean<{ userId: Types.ObjectId }[]>();
  return rows.map((r) => r.userId.toString());
}

const ids = (...v: (Types.ObjectId | string | null | undefined)[]) => [...new Set(v.filter(Boolean).map(String))];

export const automationService = {
  /** Runs every rule for every business. Returns how many alerts were raised. */
  async runAll(now = new Date()): Promise<number> {
    let n = 0;
    const businesses = await Business.find({ status: 'ACTIVE' }).select('_id ownerUserId subscription').lean<BusinessDoc[]>();
    for (const b of businesses) {
      try {
        n += await this.runForBusiness(b, now);
      } catch (err) {
        logger.error({ err, businessId: b._id }, 'Automation run failed for business');
      }
    }
    return n;
  },

  async runForBusiness(b: Pick<BusinessDoc, '_id' | 'ownerUserId' | 'subscription'>, now = new Date()): Promise<number> {
    const businessId = b._id.toString();
    const ctx: TenantContext = { businessId, userId: b.ownerUserId.toString() };
    const state = await subscriptionService.state(businessId);
    // Listing expiry is part of the listing lifecycle and runs on every plan.
    let raised = await this.expireListings(ctx, now);
    if (!hasModule(state, 'automation')) return raised;
    const rules = (await settingsService.get(ctx)).automation;
    const managers = await managerIds(businessId);
    const alerts: Alert[] = [
      ...(await this.hotLeadsUncontacted(ctx, rules, managers, now)),
      ...(await this.inactiveLeads(ctx, rules, now)),
      ...(await this.propertiesToReverify(ctx, rules, now)),
      ...(await this.expiringListings(ctx, rules, now)),
      ...(await this.stuckDeals(ctx, rules, managers, now)),
      ...(await this.expiringAgreements(ctx, rules, managers, now)),
      ...(await this.verificationsDue(ctx, rules, now)),
      ...(await this.rentAlerts(ctx, rules, managers, now)),
    ];
    for (const a of alerts) {
      if (!a.userIds.length) continue;
      raised += await notificationService.notify(ctx, { userIds: a.userIds, category: a.category, title: a.title, body: a.body, deepLink: a.deepLink, dedupeKey: a.key });
    }
    return raised;
  },

  async hotLeadsUncontacted(ctx: TenantContext, rules: AutomationSettings, managers: string[], now: Date): Promise<Alert[]> {
    const r = rules.HOT_LEAD_UNCONTACTED;
    if (!r.enabled) return [];
    const leads = await Client.find({
      businessId: ctx.businessId,
      deletedAt: null,
      status: 'ACTIVE',
      temperature: 'HOT',
      lastContactedAt: null,
      createdAt: { $lte: new Date(now.getTime() - r.threshold * MIN), $gte: new Date(now.getTime() - 7 * DAY) },
    })
      .select('fullName mobileNumber assignedTo createdAt')
      .limit(LIMIT)
      .lean<ClientDoc[]>();
    return leads.map((c) => ({
      userIds: ids(c.assignedTo, ...managers),
      category: 'LEAD',
      title: 'Hot lead not contacted',
      body: `${c.fullName} (${c.mobileNumber}) is a hot lead and nobody has contacted them for over ${r.threshold} minutes.`,
      deepLink: `/clients/${c._id}`,
      key: `HOT_LEAD_UNCONTACTED:${c._id}`,
    }));
  },

  async inactiveLeads(ctx: TenantContext, rules: AutomationSettings, now: Date): Promise<Alert[]> {
    const r = rules.LEAD_INACTIVE;
    if (!r.enabled) return [];
    const cutoff = new Date(now.getTime() - r.threshold * DAY);
    const leads = await Client.find({
      businessId: ctx.businessId,
      deletedAt: null,
      status: 'ACTIVE',
      assignedTo: { $ne: null },
      $or: [{ lastContactedAt: { $lt: cutoff } }, { lastContactedAt: null, createdAt: { $lt: cutoff } }],
    })
      .select('fullName assignedTo lastContactedAt')
      .limit(LIMIT)
      .lean<ClientDoc[]>();
    return leads.map((c) => ({
      userIds: ids(c.assignedTo),
      category: 'LEAD',
      title: 'Lead going cold',
      body: `${c.fullName} has not been contacted for ${r.threshold}+ days.`,
      deepLink: `/clients/${c._id}`,
      key: `LEAD_INACTIVE:${c._id}:${c.lastContactedAt ? new Date(c.lastContactedAt).getTime() : 'never'}`,
    }));
  },

  async propertiesToReverify(ctx: TenantContext, rules: AutomationSettings, now: Date): Promise<Alert[]> {
    const r = rules.PROPERTY_REVERIFY;
    if (!r.enabled) return [];
    const cutoff = new Date(now.getTime() - r.threshold * DAY);
    const props = await Property.find({ businessId: ctx.businessId, deletedAt: null, status: 'AVAILABLE', $or: [{ lastVerifiedAt: { $lt: cutoff } }, { lastVerifiedAt: null }] })
      .select('propertyId agentIds createdBy lastVerifiedAt society')
      .limit(LIMIT)
      .lean<PropertyDoc[]>();
    return props.map((p) => ({
      userIds: ids(...(p.agentIds?.length ? p.agentIds : [p.createdBy])),
      category: 'PROPERTY',
      title: 'Re-confirm listing',
      body: `${p.propertyId}${p.society ? ` (${p.society})` : ''} has not been re-confirmed with the owner for ${r.threshold}+ days.`,
      deepLink: `/properties/${p._id}`,
      key: `PROPERTY_REVERIFY:${p._id}:${p.lastVerifiedAt ? new Date(p.lastVerifiedAt).getTime() : 'never'}`,
    }));
  },

  async expiringListings(ctx: TenantContext, rules: AutomationSettings, now: Date): Promise<Alert[]> {
    const r = rules.LISTING_EXPIRY;
    if (!r.enabled || r.threshold <= 0) return [];
    const props = await Property.find({
      businessId: ctx.businessId,
      deletedAt: null,
      status: 'AVAILABLE',
      availabilityExpiresAt: { $gt: now, $lte: new Date(now.getTime() + r.threshold * DAY) },
    })
      .select('propertyId agentIds createdBy availabilityExpiresAt')
      .limit(LIMIT)
      .lean<PropertyDoc[]>();
    return props.map((p) => ({
      userIds: ids(...(p.agentIds?.length ? p.agentIds : [p.createdBy])),
      category: 'PROPERTY',
      title: 'Listing expiring soon',
      body: `${p.propertyId} expires on ${new Date(p.availabilityExpiresAt!).toISOString().slice(0, 10)}. Renew it with the owner or let it lapse.`,
      deepLink: `/properties/${p._id}`,
      key: `LISTING_EXPIRING:${p._id}:${new Date(p.availabilityExpiresAt!).getTime()}`,
    }));
  },

  /** Listings past their availability date become EXPIRED (and stop matching). */
  async expireListings(ctx: TenantContext, now: Date): Promise<number> {
    const due = await Property.find({ businessId: ctx.businessId, deletedAt: null, status: 'AVAILABLE', availabilityExpiresAt: { $ne: null, $lte: now } })
      .select('propertyId agentIds createdBy')
      .limit(LIMIT)
      .lean<PropertyDoc[]>();
    let n = 0;
    for (const p of due) {
      const res = await Property.updateOne(
        { _id: p._id, businessId: ctx.businessId, status: 'AVAILABLE' },
        { $set: { status: 'EXPIRED', statusChangedAt: now }, $inc: { version: 1 } },
      );
      if (!res.modifiedCount) continue;
      await activityService.record(ctx, 'STATUS_CHANGED', `${p.propertyId} Available → Expired (availability date passed)`, [{ entityType: 'property', entityId: p._id, label: p.propertyId }], {
        from: 'AVAILABLE',
        to: 'EXPIRED',
        automatic: true,
      });
      await matchingService.markPropertyStale(ctx, p._id);
      n += await notificationService.notify(ctx, {
        userIds: ids(...(p.agentIds?.length ? p.agentIds : [p.createdBy])),
        category: 'PROPERTY',
        title: 'Listing expired',
        body: `${p.propertyId} passed its availability date and is now marked Expired.`,
        deepLink: `/properties/${p._id}`,
        dedupeKey: `LISTING_EXPIRED:${p._id}:${now.toISOString().slice(0, 10)}`,
      });
    }
    return n;
  },

  async stuckDeals(ctx: TenantContext, rules: AutomationSettings, managers: string[], now: Date): Promise<Alert[]> {
    const r = rules.DEAL_STUCK_NEGOTIATION;
    if (!r.enabled) return [];
    const deals = await Deal.find({ businessId: ctx.businessId, deletedAt: null, stage: 'NEGOTIATION' }).select('dealNo title agents stageHistory').limit(500).lean<DealDoc[]>();
    const out: Alert[] = [];
    for (const d of deals) {
      const entered = [...(d.stageHistory ?? [])].reverse().find((h) => h.stage === 'NEGOTIATION')?.at;
      if (!entered || now.getTime() - new Date(entered).getTime() < r.threshold * DAY) continue;
      out.push({
        userIds: ids(...d.agents.map((a) => a.userId), ...managers),
        category: 'DEAL',
        title: 'Deal stuck in negotiation',
        body: `${d.dealNo}${d.title ? ` (${d.title})` : ''} has been in negotiation for ${r.threshold}+ days.`,
        deepLink: `/deals/${d._id}`,
        key: `DEAL_STUCK:${d._id}:${new Date(entered).getTime()}`,
      });
    }
    return out;
  },

  async expiringAgreements(ctx: TenantContext, rules: AutomationSettings, managers: string[], now: Date): Promise<Alert[]> {
    const r = rules.AGREEMENT_EXPIRING;
    if (!r.enabled) return [];
    const list = await Agreement.find({
      businessId: ctx.businessId,
      deletedAt: null,
      status: { $in: ['SENT', 'SIGNED'] },
      endDate: { $gt: now, $lte: new Date(now.getTime() + r.threshold * DAY) },
    })
      .select('agreementNo title endDate createdBy')
      .limit(LIMIT)
      .lean<{ _id: Types.ObjectId; agreementNo?: string; title?: string; endDate: Date; createdBy: Types.ObjectId }[]>();
    return list.map((a) => ({
      userIds: ids(a.createdBy, ...managers),
      category: 'AUTOMATION',
      title: 'Agreement expiring',
      body: `${a.agreementNo ?? a.title ?? 'An agreement'} ends on ${new Date(a.endDate).toISOString().slice(0, 10)}. Plan the renewal.`,
      deepLink: `/agreements/${a._id}`,
      key: `AGREEMENT_EXPIRING:${a._id}:${new Date(a.endDate).getTime()}`,
    }));
  },

  /** Approved listings whose next verification date is near, and documents about to expire. */
  async verificationsDue(ctx: TenantContext, rules: AutomationSettings, now: Date): Promise<Alert[]> {
    const r = rules.VERIFICATION_DUE;
    if (!r.enabled) return [];
    const until = new Date(now.getTime() + r.threshold * DAY);
    const props = await Property.find({ businessId: ctx.businessId, deletedAt: null, status: { $in: ['AVAILABLE', 'RESERVED', 'UNDER_NEGOTIATION'] }, 'verification.status': 'APPROVED', 'verification.nextVerificationAt': { $ne: null, $lte: until } })
      .select('propertyId agentIds createdBy verification.nextVerificationAt verification.verifiedBy')
      .limit(LIMIT)
      .lean<PropertyDoc[]>();
    const out: Alert[] = props.map((p) => ({
      userIds: ids(p.verification?.verifiedBy, ...(p.agentIds?.length ? p.agentIds : [p.createdBy])),
      category: 'PROPERTY',
      title: 'Re-verification due',
      body: `${p.propertyId} is due for re-verification on ${new Date(p.verification!.nextVerificationAt!).toISOString().slice(0, 10)}.`,
      deepLink: `/properties/${p._id}?tab=verification`,
      key: `VERIFICATION_DUE:${p._id}:${new Date(p.verification!.nextVerificationAt!).getTime()}`,
    }));
    const docs = await DocumentAsset.find({ businessId: ctx.businessId, deletedAt: null, expiresAt: { $ne: null, $gt: now, $lte: new Date(now.getTime() + Math.max(r.threshold, 30) * DAY) } })
      .select('fileName entityType entityId uploadedBy expiresAt')
      .limit(LIMIT)
      .lean<{ _id: Types.ObjectId; fileName: string; entityType: string; entityId: Types.ObjectId; uploadedBy: Types.ObjectId; expiresAt: Date }[]>();
    for (const d of docs) {
      const route = { property: 'properties', client: 'clients', owner: 'owners', deal: 'deals', agreement: 'agreements', transaction: 'finance' }[d.entityType] ?? 'documents';
      out.push({
        userIds: ids(d.uploadedBy),
        category: 'AUTOMATION',
        title: 'Document expiring',
        body: `"${d.fileName}" expires on ${new Date(d.expiresAt).toISOString().slice(0, 10)}.`,
        deepLink: `/${route}/${d.entityId}`,
        key: `DOCUMENT_EXPIRING:${d._id}:${new Date(d.expiresAt).getTime()}`,
      });
    }
    return out;
  },

  /** Rent falling due soon (manager reminder) and rent overdue past the threshold (manager + managers). */
  async rentAlerts(ctx: TenantContext, rules: AutomationSettings, managers: string[], now: Date): Promise<Alert[]> {
    const out: Alert[] = [];
    const leases = await Lease.find({ businessId: ctx.businessId, deletedAt: null, status: 'ACTIVE' })
      .select('leaseNo managerId createdBy schedule tenantId')
      .populate({ path: 'tenantId', select: 'fullName', options: { skipTenantGuard: true } })
      .limit(500)
      .lean<LeaseDoc[]>();
    for (const l of leases) {
      const tenant = (l.tenantId as unknown as { fullName?: string })?.fullName ?? '';
      for (const it of l.schedule) {
        const bal = it.status === 'WAIVED' ? 0 : it.amount + (it.lateFee ?? 0) - (it.paid ?? 0);
        if (bal <= 0) continue;
        const due = new Date(it.dueDate).getTime();
        if (rules.RENT_DUE.enabled && due > now.getTime() && due - now.getTime() <= rules.RENT_DUE.threshold * DAY) {
          out.push({ userIds: ids(l.managerId ?? l.createdBy), category: 'AUTOMATION', title: 'Rent due soon', body: `${l.leaseNo}: ${tenant} owes Rs ${bal.toLocaleString('en-PK')} for ${it.period} on ${new Date(it.dueDate).toISOString().slice(0, 10)}.`, deepLink: `/leases/${l._id}`, key: `RENT_DUE:${l._id}:${it._id}` });
        }
        if (rules.RENT_OVERDUE.enabled && now.getTime() - due >= rules.RENT_OVERDUE.threshold * DAY) {
          out.push({ userIds: ids(l.managerId ?? l.createdBy, ...managers), category: 'AUTOMATION', title: 'Rent overdue', body: `${l.leaseNo}: ${tenant} has not paid Rs ${bal.toLocaleString('en-PK')} for ${it.period}.`, deepLink: `/leases/${l._id}`, key: `RENT_OVERDUE:${l._id}:${it._id}` });
        }
      }
    }
    return out;
  },

  /** Engagement decays with time, so active leads are rescored periodically. */
  async rescoreStaleLeads(now = new Date(), maxAgeMs = 12 * 3_600_000): Promise<number> {
    const stale = await Client.find({ deletedAt: null, status: 'ACTIVE', $or: [{ leadScoredAt: null }, { leadScoredAt: { $lt: new Date(now.getTime() - maxAgeMs) } }] })
      .setOptions(skip)
      .select('businessId')
      .limit(500)
      .lean<ClientDoc[]>();
    for (const c of stale) await leadService.safeRescore({ businessId: c.businessId.toString(), userId: c.businessId.toString() }, c._id.toString());
    return stale.length;
  },
};
