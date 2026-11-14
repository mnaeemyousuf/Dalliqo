import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  ERROR_CODES,
  SOCKET_EVENTS,
  allocatePayment,
  buildRentSchedule,
  itemBalance,
  lateFeeFor,
  statusFor,
  summarizeLease,
  type InspectionType,
  type LateFeeType,
  type PaymentMethod,
} from '@recrm/shared';
import { nextSequence } from '../models/Counter';
import { Lease, type LeaseDoc, type RentItemDoc } from '../models/Lease';
import { Property } from '../models/Property';
import { TransactionCategory } from '../models/TransactionCategory';
import { clientRepository, ownerRepository, propertyRepository } from '../repositories/entityRepositories';
import { memberRepository } from '../repositories/memberRepository';
import { createTenantRepository, type Filter } from '../repositories/tenantRepository';
import type { AuthContext, RequestMeta, TenantContext } from '../types/context';
import { badRequest, notFound } from '../utils/AppError';
import { escapeRegex, formatPkr, searchBlob } from '../utils/text';
import { withTransaction } from '../utils/transaction';
import { activityService, type ActivityRef } from './activityService';
import { auditService } from './auditService';
import { branchFilter } from './branchScope';
import { publishChange } from './publish';

export const leaseRepository = createTenantRepository<LeaseDoc>(Lease, ERROR_CODES.NOT_FOUND);
export const formatLeaseNo = (n: number) => `LS-${String(n).padStart(6, '0')}`;

export interface LeaseInput {
  uuid?: string;
  branchId?: string;
  propertyId: string;
  landlordId?: string | null;
  tenantId: string;
  agreementId?: string | null;
  managerId?: string | null;
  startDate: Date;
  endDate: Date;
  monthlyRent: number;
  dueDay?: number;
  escalationPct?: number;
  graceDays?: number;
  lateFeeType?: LateFeeType;
  lateFeeValue?: number;
  securityDeposit?: number;
  managementFeePct?: number;
  notes?: string;
  /** Mark the property as RENTED (default true). */
  markRented?: boolean;
}

export interface RentPaymentInput {
  id?: string;
  date: Date;
  amount: number;
  method?: PaymentMethod;
  reference?: string;
  notes?: string;
}

const refs = (l: Pick<LeaseDoc, '_id' | 'leaseNo' | 'propertyId' | 'tenantId'>): ActivityRef[] => [
  { entityType: 'lease', entityId: l._id, label: l.leaseNo },
  { entityType: 'property', entityId: l.propertyId },
  { entityType: 'client', entityId: l.tenantId },
];

/** Recomputes statuses (overdue, paid), late fees and the denormalised totals. */
function refresh(l: Pick<LeaseDoc, 'schedule' | 'graceDays' | 'lateFeeType' | 'lateFeeValue' | 'status'> & { createdAt?: Date }, now = Date.now()) {
  // Months that were already past due when the lease was entered (back-dated leases) never get a late fee.
  const feesFrom = l.createdAt ? new Date(l.createdAt).getTime() : now;
  const schedule: RentItemDoc[] = l.schedule.map((it) => {
    let next = { ...it };
    const s = statusFor(next, now, l.graceDays);
    // A late fee is charged once, the first time an item is seen overdue (never on waived items).
    const becameOverdueAt = new Date(next.dueDate).getTime() + l.graceDays * 86_400_000;
    if (s === 'OVERDUE' && !next.lateFee && l.lateFeeType !== 'NONE' && l.status === 'ACTIVE' && becameOverdueAt >= feesFrom) {
      next = { ...next, lateFee: lateFeeFor(next.amount, l.lateFeeType, l.lateFeeValue) };
    }
    return { ...next, status: statusFor(next, now, l.graceDays) };
  });
  const sum = summarizeLease(schedule, now);
  return {
    schedule,
    outstanding: sum.outstanding,
    overdueAmount: schedule.filter((i) => i.status === 'OVERDUE').reduce((s, i) => s + itemBalance(i), 0),
    nextDueDate: sum.nextDue ? new Date(sum.nextDue.dueDate) : null,
  };
}

async function feeCategoryId(ctx: TenantContext): Promise<Types.ObjectId | null> {
  const c = await TransactionCategory.findOne({ businessId: ctx.businessId, key: 'RENT_COLLECTION', deletedAt: null }).select('_id').lean<{ _id: Types.ObjectId }>();
  return c?._id ?? null;
}

export const leaseService = {
  async create(auth: AuthContext, input: LeaseInput, meta: RequestMeta = {}) {
    if (input.uuid) {
      const existing = await leaseRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    if (!(new Date(input.endDate) > new Date(input.startDate))) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The lease must end after it starts');
    const property = await propertyRepository.getById(auth, input.propertyId, 'Property not found');
    const tenant = await clientRepository.getById(auth, input.tenantId, 'Tenant not found');
    if (input.landlordId && !(await ownerRepository.findById(auth, input.landlordId))) throw badRequest(ERROR_CODES.OWNER_NOT_FOUND, 'Landlord not found');
    if (input.managerId && !(await memberRepository.isActiveMemberUser(auth, input.managerId))) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Manager is not an active member');
    const active = await leaseRepository.findOne(auth, { propertyId: property._id, status: 'ACTIVE', endDate: { $gt: new Date(input.startDate) } });
    if (active) throw badRequest(ERROR_CODES.VALIDATION_ERROR, `This property already has an active lease (${active.leaseNo})`);

    const base = {
      graceDays: input.graceDays ?? 5,
      lateFeeType: input.lateFeeType ?? 'NONE',
      lateFeeValue: input.lateFeeValue ?? 0,
      status: 'ACTIVE' as const,
      schedule: buildRentSchedule({ startDate: input.startDate, endDate: input.endDate, monthlyRent: input.monthlyRent, dueDay: input.dueDay ?? 1, escalationPct: input.escalationPct }).map((s) => ({ ...s, _id: randomUUID(), dueDate: new Date(s.dueDate), waivedReason: null })),
    };
    const computed = refresh(base);
    const lease = await withTransaction(async (session) => {
      const leaseNo = formatLeaseNo(await nextSequence(auth.businessId, 'lease', session));
      return leaseRepository.create(
        auth,
        {
          ...(input.uuid ? { uuid: input.uuid } : {}),
          branchId: input.branchId ?? property.branchId,
          leaseNo,
          propertyId: property._id,
          landlordId: input.landlordId ?? property.ownerId ?? null,
          tenantId: tenant._id,
          agreementId: input.agreementId ?? null,
          managerId: input.managerId ?? auth.userId,
          startDate: input.startDate,
          endDate: input.endDate,
          monthlyRent: input.monthlyRent,
          dueDay: input.dueDay ?? 1,
          escalationPct: input.escalationPct ?? 0,
          securityDeposit: input.securityDeposit ?? 0,
          managementFeePct: input.managementFeePct ?? 0,
          notes: input.notes,
          ...base,
          ...computed,
          searchText: searchBlob(leaseNo, property.propertyId, tenant.fullName, property.society, property.block),
        },
        session,
      );
    });
    if (input.markRented !== false && property.status !== 'RENTED') {
      await Property.updateOne({ _id: property._id, businessId: auth.businessId }, { $set: { status: 'RENTED', statusChangedAt: new Date() }, $inc: { version: 1 } });
    }
    await activityService.record(auth, 'LEASE_CREATED', `Lease ${lease.leaseNo}: ${property.propertyId} let to ${tenant.fullName} at ${formatPkr(input.monthlyRent)}/month`, refs(lease));
    await auditService.record(auth, { action: 'lease.created', entityType: 'lease', entityId: lease._id, entityLabel: lease.leaseNo, ip: meta.ip });
    publishChange(auth, SOCKET_EVENTS.PROPERTY_UPDATED, 'property', { _id: property._id } as never);
    return lease;
  },

  async list(ctx: TenantContext, q: { q?: string; status?: string; propertyId?: string; tenantId?: string; landlordId?: string; overdue?: boolean; page: number; limit: number }) {
    const filter: Filter = {};
    if (q.q) filter.$and = searchBlob(q.q).split(' ').filter(Boolean).map((t) => ({ searchText: new RegExp(`(^|\\s)${escapeRegex(t)}`) }));
    if (q.status) filter.status = q.status;
    if (q.propertyId) filter.propertyId = q.propertyId;
    if (q.tenantId) filter.tenantId = q.tenantId;
    if (q.landlordId) filter.landlordId = q.landlordId;
    if (q.overdue) filter.overdueAmount = { $gt: 0 };
    return leaseRepository.list(ctx, filter, {
      page: q.page,
      limit: q.limit,
      sort: q.overdue ? { overdueAmount: -1, _id: 1 } : { updatedAt: -1, _id: -1 },
      populate: [
        { path: 'propertyId', select: 'propertyId society block coverThumbnailUrl' },
        { path: 'tenantId', select: 'fullName mobileNumber whatsappNumber' },
        { path: 'landlordId', select: 'fullName mobileNumber' },
      ],
    });
  },

  async get(ctx: TenantContext, id: string) {
    const l = await Lease.findOne({ businessId: ctx.businessId, _id: id, deletedAt: null, ...branchFilter(ctx) })
      .populate({ path: 'propertyId', select: 'propertyId society block area propertyType coverThumbnailUrl', options: { skipTenantGuard: true } })
      .populate({ path: 'tenantId', select: 'fullName mobileNumber whatsappNumber', options: { skipTenantGuard: true } })
      .populate({ path: 'landlordId', select: 'fullName mobileNumber whatsappNumber', options: { skipTenantGuard: true } })
      .lean<LeaseDoc>();
    if (!l) throw notFound(ERROR_CODES.NOT_FOUND, 'Lease not found');
    return { ...l, summary: summarizeLease(l.schedule) };
  },

  /** Records a rent payment, allocated oldest-first; any excess stays as tenant credit. */
  async recordPayment(auth: AuthContext, id: string, p: RentPaymentInput, meta: RequestMeta = {}) {
    const lease = await leaseRepository.getById(auth, id, 'Lease not found');
    const paymentId = p.id ?? randomUUID();
    if (lease.payments.some((x) => x._id === paymentId)) return lease; // offline replay
    if (lease.status === 'DRAFT') throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Activate the lease before recording rent');
    const { allocations, credit } = allocatePayment(lease.schedule, p.amount + (lease.credit ?? 0));
    const schedule = lease.schedule.map((it) => {
      const a = allocations.find((x) => x.itemId === it._id);
      return a ? { ...it, paid: it.paid + a.amount } : it;
    });
    let transactionId: Types.ObjectId | null = null;
    if (lease.managementFeePct > 0) {
      const fee = Math.round((p.amount * lease.managementFeePct) / 100);
      const categoryId = await feeCategoryId(auth);
      if (fee > 0 && categoryId) {
        const { transactionService } = await import('./transactionService');
        const t = await transactionService.create(
          auth,
          { type: 'INCOME', categoryId: categoryId.toString(), amount: fee, date: p.date, method: p.method, propertyId: lease.propertyId.toString(), clientId: lease.tenantId.toString(), description: `Rent collection fee — ${lease.leaseNo}`, reference: p.reference },
          meta,
          { source: 'RENTAL' as never, sourceKey: `lease:${lease._id}:payment:${paymentId}` },
        ).catch(() => null);
        transactionId = t?._id ?? null;
      }
    }
    const payment = { _id: paymentId, date: new Date(p.date), amount: Math.round(p.amount), method: p.method ?? 'CASH', reference: p.reference ?? null, notes: p.notes ?? null, allocations, transactionId, createdBy: new Types.ObjectId(auth.userId) };
    const computed = refresh({ ...lease, schedule });
    const updated = await leaseRepository.update(auth, id, { ...computed, credit, payments: [...lease.payments, payment] });
    await activityService.record(auth, 'RENT_RECEIVED', `Rent of ${formatPkr(payment.amount)} received on ${lease.leaseNo}`, refs(lease), { amount: payment.amount });
    await auditService.record(auth, { action: 'lease.payment_recorded', entityType: 'lease', entityId: lease._id, entityLabel: lease.leaseNo, meta: { paymentId, amount: payment.amount, allocations }, ip: meta.ip });
    return updated;
  },

  /** Waives a month (e.g. agreed rent-free period); reason recorded and audited. */
  async waive(auth: AuthContext, id: string, itemId: string, reason: string) {
    const lease = await leaseRepository.getById(auth, id, 'Lease not found');
    const item = lease.schedule.find((i) => i._id === itemId);
    if (!item) throw notFound(ERROR_CODES.NOT_FOUND, 'Rent item not found');
    if (item.paid > 0) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'A month with payments cannot be waived');
    const schedule = lease.schedule.map((i) => (i._id === itemId ? { ...i, status: 'WAIVED' as const, waivedReason: reason } : i));
    const updated = await leaseRepository.update(auth, id, { ...refresh({ ...lease, schedule }), schedule: refresh({ ...lease, schedule }).schedule });
    await auditService.record(auth, { action: 'lease.rent_waived', entityType: 'lease', entityId: lease._id, entityLabel: lease.leaseNo, meta: { period: item.period, amount: item.amount, reason } });
    return updated;
  },

  async addInspection(auth: AuthContext, id: string, input: { date: Date; type: InspectionType; condition: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR'; notes?: string }) {
    const lease = await leaseRepository.getById(auth, id, 'Lease not found');
    const inspection = { _id: randomUUID(), date: new Date(input.date), type: input.type, condition: input.condition, notes: input.notes ?? null, by: new Types.ObjectId(auth.userId) };
    const updated = await leaseRepository.update(auth, id, { inspections: [...lease.inspections, inspection] });
    await activityService.record(auth, 'LEASE_UPDATED', `${lease.leaseNo}: ${input.type.toLowerCase().replace('_', '-')} inspection (${input.condition.toLowerCase()})`, refs(lease));
    return updated;
  },

  /** Extends the lease and adds schedule months (with the yearly escalation continuing). */
  async renew(auth: AuthContext, id: string, input: { endDate: Date; monthlyRent?: number }) {
    const lease = await leaseRepository.getById(auth, id, 'Lease not found');
    if (!(new Date(input.endDate) > lease.endDate)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The new end date must be after the current one');
    const from = new Date(Date.UTC(lease.endDate.getUTCFullYear(), lease.endDate.getUTCMonth() + 1, 1));
    const lastRent = input.monthlyRent ?? lease.schedule[lease.schedule.length - 1]?.amount ?? lease.monthlyRent;
    const extra = buildRentSchedule({ startDate: from, endDate: input.endDate, monthlyRent: lastRent, dueDay: lease.dueDay, escalationPct: lease.escalationPct })
      .filter((s) => !lease.schedule.some((x) => x.period === s.period))
      .map((s) => ({ ...s, _id: randomUUID(), dueDate: new Date(s.dueDate), waivedReason: null }));
    const schedule = [...lease.schedule, ...extra];
    const updated = await leaseRepository.update(auth, id, { endDate: input.endDate, status: 'ACTIVE', ...refresh({ ...lease, schedule, status: 'ACTIVE' }) });
    await activityService.record(auth, 'LEASE_UPDATED', `${lease.leaseNo} renewed until ${new Date(input.endDate).toISOString().slice(0, 10)}${input.monthlyRent ? ` at ${formatPkr(input.monthlyRent)}` : ''}`, refs(lease));
    await auditService.record(auth, { action: 'lease.renewed', entityType: 'lease', entityId: lease._id, entityLabel: lease.leaseNo, changes: [{ field: 'endDate', oldValue: lease.endDate, newValue: input.endDate }] });
    return updated;
  },

  /** Ends the lease early or at term; future unpaid months are removed, the property can go back on the market. */
  async end(auth: AuthContext, id: string, input: { status: 'ENDED' | 'TERMINATED'; date?: Date; reason?: string; depositRefund?: number; relist?: boolean }) {
    const lease = await leaseRepository.getById(auth, id, 'Lease not found');
    if (lease.status === 'ENDED' || lease.status === 'TERMINATED') return lease;
    const at = input.date ? new Date(input.date) : new Date();
    const schedule = lease.schedule.filter((i) => new Date(i.dueDate) <= at || i.paid > 0);
    const refund = Math.min(input.depositRefund ?? 0, lease.securityDeposit);
    const depositStatus = refund >= lease.securityDeposit && lease.securityDeposit > 0 ? 'REFUNDED' : refund > 0 ? 'PARTIALLY_REFUNDED' : lease.depositStatus;
    const updated = await leaseRepository.update(auth, id, {
      status: input.status,
      endedAt: at,
      endReason: input.reason ?? null,
      depositRefunded: refund,
      depositStatus,
      ...refresh({ ...lease, schedule, status: input.status }),
    });
    if (input.relist !== false) {
      await Property.updateOne({ _id: lease.propertyId, businessId: auth.businessId, status: 'RENTED' }, { $set: { status: 'AVAILABLE', statusChangedAt: new Date() }, $inc: { version: 1 } });
    }
    await activityService.record(auth, 'LEASE_ENDED', `${lease.leaseNo} ${input.status === 'TERMINATED' ? 'terminated' : 'ended'}${input.reason ? `: ${input.reason}` : ''}`, refs(lease));
    await auditService.record(auth, { action: `lease.${input.status.toLowerCase()}`, entityType: 'lease', entityId: lease._id, entityLabel: lease.leaseNo, meta: { reason: input.reason, depositRefund: refund } });
    return updated;
  },

  /** Rent roll: what each active lease owes now and what falls due this month. */
  async rentRoll(ctx: TenantContext) {
    const leases = await Lease.find({ businessId: ctx.businessId, deletedAt: null, status: 'ACTIVE', ...branchFilter(ctx) })
      .select('leaseNo propertyId tenantId monthlyRent outstanding overdueAmount nextDueDate schedule securityDeposit endDate')
      .populate({ path: 'propertyId', select: 'propertyId society block', options: { skipTenantGuard: true } })
      .populate({ path: 'tenantId', select: 'fullName mobileNumber', options: { skipTenantGuard: true } })
      .lean<LeaseDoc[]>();
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    let dueThisMonth = 0;
    let collectedThisMonth = 0;
    for (const l of leases) {
      const it = l.schedule.find((i) => i.period === month && i.status !== 'WAIVED');
      if (it) {
        dueThisMonth += it.amount + it.lateFee;
        collectedThisMonth += it.paid;
      }
    }
    const expiringSoon = leases.filter((l) => +l.endDate - +now < 60 * 86_400_000).length;
    return {
      activeLeases: leases.length,
      monthlyRentRoll: leases.reduce((s, l) => s + l.monthlyRent, 0),
      dueThisMonth,
      collectedThisMonth,
      overdue: leases.reduce((s, l) => s + l.overdueAmount, 0),
      depositsHeld: leases.reduce((s, l) => s + l.securityDeposit, 0),
      expiringSoon,
      rows: leases
        .map((l) => ({ _id: l._id, leaseNo: l.leaseNo, property: l.propertyId, tenant: l.tenantId, monthlyRent: l.monthlyRent, overdue: l.overdueAmount, nextDueDate: l.nextDueDate, endDate: l.endDate }))
        .sort((a, b) => b.overdue - a.overdue),
    };
  },

  /** Scheduled: marks overdue months and charges late fees across all businesses. */
  async refreshAll(now = new Date()): Promise<number> {
    const due = await Lease.find({ deletedAt: null, status: 'ACTIVE', schedule: { $elemMatch: { dueDate: { $lt: now }, status: { $in: ['PENDING', 'PARTIAL'] } } } })
      .setOptions({ skipTenantGuard: true } as never)
      .limit(500)
      .lean<LeaseDoc[]>();
    for (const l of due) {
      const computed = refresh(l, now.getTime());
      await Lease.updateOne({ _id: l._id, businessId: l.businessId }, { $set: computed });
    }
    return due.length;
  },
};
