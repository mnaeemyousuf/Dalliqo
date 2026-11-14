import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  ERROR_CODES,
  allocatePayment,
  buildInstallmentSchedule,
  itemBalance,
  statusFor,
  type InstallmentFrequency,
  type InstallmentKind,
  type PaymentMethod,
} from '@recrm/shared';
import { nextSequence } from '../models/Counter';
import { InstallmentPlan, type InstallmentItemDoc, type InstallmentPlanDoc } from '../models/InstallmentPlan';
import { clientRepository, propertyRepository } from '../repositories/entityRepositories';
import { createTenantRepository, type Filter } from '../repositories/tenantRepository';
import type { AuthContext, RequestMeta, TenantContext } from '../types/context';
import { badRequest, notFound } from '../utils/AppError';
import { escapeRegex, formatPkr, searchBlob } from '../utils/text';
import { withTransaction } from '../utils/transaction';
import { activityService, type ActivityRef } from './activityService';
import { auditService } from './auditService';
import { branchFilter } from './branchScope';
import { dealRepository } from './dealService';

export const installmentRepository = createTenantRepository<InstallmentPlanDoc>(InstallmentPlan, ERROR_CODES.NOT_FOUND);
export const formatPlanNo = (n: number) => `IP-${String(n).padStart(6, '0')}`;

export interface InstallmentPlanInput {
  uuid?: string;
  branchId?: string;
  dealId?: string | null;
  clientId: string;
  propertyId?: string | null;
  title?: string;
  totalAmount: number;
  bookingAmount?: number;
  downPayment?: number;
  possessionAmount?: number;
  frequency: InstallmentFrequency;
  count?: number;
  startDate: Date;
  graceDays?: number;
  /** CUSTOM plans: the exact items. */
  items?: { kind?: InstallmentKind; label: string; dueDate: Date; amount: number }[];
  notes?: string;
}

const refs = (p: Pick<InstallmentPlanDoc, 'clientId' | 'propertyId' | 'dealId'>): ActivityRef[] => [
  { entityType: 'client', entityId: p.clientId },
  ...(p.propertyId ? [{ entityType: 'property' as const, entityId: p.propertyId }] : []),
  ...(p.dealId ? [{ entityType: 'deal' as const, entityId: p.dealId }] : []),
];

function refresh(p: Pick<InstallmentPlanDoc, 'items' | 'graceDays' | 'payments'>, now = Date.now()) {
  const items: InstallmentItemDoc[] = p.items.map((i) => ({ ...i, status: statusFor(i, now, p.graceDays) }));
  const open = items.filter((i) => itemBalance(i) > 0).sort((a, b) => +a.dueDate - +b.dueDate);
  return {
    items,
    outstanding: items.reduce((s, i) => s + itemBalance(i), 0),
    overdueAmount: items.filter((i) => i.status === 'OVERDUE').reduce((s, i) => s + itemBalance(i), 0),
    paidTotal: (p.payments ?? []).reduce((s, x) => s + x.amount, 0),
    nextDueDate: open.find((i) => +i.dueDate >= now)?.dueDate ?? null,
  };
}

export const installmentService = {
  async create(auth: AuthContext, input: InstallmentPlanInput, meta: RequestMeta = {}) {
    if (input.uuid) {
      const existing = await installmentRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    const client = await clientRepository.getById(auth, input.clientId, 'Client not found');
    const property = input.propertyId ? await propertyRepository.getById(auth, input.propertyId, 'Property not found') : null;
    if (input.dealId && !(await dealRepository.findById(auth, input.dealId))) throw badRequest(ERROR_CODES.DEAL_NOT_FOUND, 'Deal not found');
    const planned =
      input.frequency === 'CUSTOM'
        ? (input.items ?? []).map((i) => ({ kind: i.kind ?? ('INSTALLMENT' as const), label: i.label, dueDate: new Date(i.dueDate), amount: Math.round(i.amount) }))
        : buildInstallmentSchedule({ ...input, count: input.count ?? 12 });
    if (!planned.length) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The plan has no installments');
    const sum = planned.reduce((s, i) => s + i.amount, 0);
    if (Math.abs(sum - Math.round(input.totalAmount)) > 1) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, `Installments add up to ${formatPkr(sum)}, not the total ${formatPkr(input.totalAmount)}`);
    }
    const items: InstallmentItemDoc[] = planned.map((i) => ({ _id: randomUUID(), ...i, lateFee: 0, paid: 0, status: 'PENDING' }));
    const graceDays = input.graceDays ?? 7;
    const computed = refresh({ items, graceDays, payments: [] });
    const plan = await withTransaction(async (session) => {
      const planNo = formatPlanNo(await nextSequence(auth.businessId, 'installmentPlan', session));
      return installmentRepository.create(
        auth,
        {
          ...(input.uuid ? { uuid: input.uuid } : {}),
          branchId: input.branchId ?? property?.branchId ?? client.branchId,
          planNo,
          dealId: input.dealId ?? null,
          clientId: client._id,
          propertyId: property?._id ?? null,
          title: input.title,
          totalAmount: Math.round(input.totalAmount),
          frequency: input.frequency,
          graceDays,
          notes: input.notes,
          payments: [],
          ...computed,
          searchText: searchBlob(planNo, client.fullName, property?.propertyId, input.title),
        },
        session,
      );
    });
    await activityService.record(auth, 'INSTALLMENT_PLAN_CREATED', `Installment plan ${plan.planNo} for ${client.fullName}: ${formatPkr(plan.totalAmount)} in ${items.length} payments`, refs(plan));
    await auditService.record(auth, { action: 'installment_plan.created', entityType: 'installmentPlan', entityId: plan._id, entityLabel: plan.planNo, ip: meta.ip });
    return plan;
  },

  async list(ctx: TenantContext, q: { q?: string; status?: string; clientId?: string; dealId?: string; overdue?: boolean; page: number; limit: number }) {
    const filter: Filter = {};
    if (q.q) filter.$and = searchBlob(q.q).split(' ').filter(Boolean).map((t) => ({ searchText: new RegExp(`(^|\\s)${escapeRegex(t)}`) }));
    if (q.status) filter.status = q.status;
    if (q.clientId) filter.clientId = q.clientId;
    if (q.dealId) filter.dealId = q.dealId;
    if (q.overdue) filter.overdueAmount = { $gt: 0 };
    return installmentRepository.list(ctx, filter, {
      page: q.page,
      limit: q.limit,
      sort: q.overdue ? { overdueAmount: -1, _id: 1 } : { updatedAt: -1, _id: -1 },
      populate: [
        { path: 'clientId', select: 'fullName mobileNumber' },
        { path: 'propertyId', select: 'propertyId society block' },
        { path: 'dealId', select: 'dealNo' },
      ],
    });
  },

  async get(ctx: TenantContext, id: string) {
    const p = await InstallmentPlan.findOne({ businessId: ctx.businessId, _id: id, deletedAt: null, ...branchFilter(ctx) })
      .populate({ path: 'clientId', select: 'fullName mobileNumber whatsappNumber', options: { skipTenantGuard: true } })
      .populate({ path: 'propertyId', select: 'propertyId society block', options: { skipTenantGuard: true } })
      .populate({ path: 'dealId', select: 'dealNo title', options: { skipTenantGuard: true } })
      .lean<InstallmentPlanDoc>();
    if (!p) throw notFound(ERROR_CODES.NOT_FOUND, 'Installment plan not found');
    return p;
  },

  async recordPayment(auth: AuthContext, id: string, input: { id?: string; date: Date; amount: number; method?: PaymentMethod; reference?: string; notes?: string }, meta: RequestMeta = {}) {
    const plan = await installmentRepository.getById(auth, id, 'Installment plan not found');
    const paymentId = input.id ?? randomUUID();
    if (plan.payments.some((x) => x._id === paymentId)) return plan;
    if (plan.status !== 'ACTIVE') throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'This plan is not active');
    const { allocations, credit } = allocatePayment(plan.items, input.amount + (plan.credit ?? 0));
    const items = plan.items.map((it) => {
      const a = allocations.find((x) => x.itemId === it._id);
      return a ? { ...it, paid: it.paid + a.amount } : it;
    });
    const payments = [...plan.payments, { _id: paymentId, date: new Date(input.date), amount: Math.round(input.amount), method: input.method ?? 'CASH', reference: input.reference ?? null, notes: input.notes ?? null, allocations, createdBy: new Types.ObjectId(auth.userId) }];
    const computed = refresh({ ...plan, items, payments });
    const updated = await installmentRepository.update(auth, id, { ...computed, credit, payments, ...(computed.outstanding === 0 ? { status: 'COMPLETED' } : {}) });
    await activityService.record(auth, 'INSTALLMENT_RECEIVED', `${formatPkr(input.amount)} received on ${plan.planNo}${computed.outstanding === 0 ? ' — plan fully paid' : ''}`, refs(plan), { amount: input.amount });
    await auditService.record(auth, { action: 'installment_plan.payment_recorded', entityType: 'installmentPlan', entityId: plan._id, entityLabel: plan.planNo, meta: { paymentId, amount: input.amount, allocations }, ip: meta.ip });
    return updated;
  },

  async cancel(auth: AuthContext, id: string, reason: string) {
    const plan = await installmentRepository.getById(auth, id, 'Installment plan not found');
    const updated = await installmentRepository.update(auth, id, { status: 'CANCELLED', cancelReason: reason });
    await auditService.record(auth, { action: 'installment_plan.cancelled', entityType: 'installmentPlan', entityId: plan._id, entityLabel: plan.planNo, meta: { reason } });
    return updated;
  },

  /** Scheduled: marks overdue installments across all businesses. */
  async refreshAll(now = new Date()): Promise<number> {
    const due = await InstallmentPlan.find({ deletedAt: null, status: 'ACTIVE', items: { $elemMatch: { dueDate: { $lt: now }, status: { $in: ['PENDING', 'PARTIAL'] } } } })
      .setOptions({ skipTenantGuard: true } as never)
      .limit(500)
      .lean<InstallmentPlanDoc[]>();
    for (const p of due) await InstallmentPlan.updateOne({ _id: p._id, businessId: p.businessId }, { $set: refresh(p, now.getTime()) });
    return due.length;
  },
};
