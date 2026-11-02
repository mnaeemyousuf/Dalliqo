import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  ERROR_CODES,
  OPEN_DEAL_STAGES,
  PERMISSIONS,
  SOCKET_EVENTS,
  sharesValid,
  summarizeCommission,
  type CommissionMode,
  type CommissionStatus,
  type DealSide,
  type DealStage,
  type PaymentMethod,
  type PayoutStatus,
} from '@recrm/shared';
import { nextSequence } from '../models/Counter';
import { Deal, type DealDoc, type DealPayment, type DealPayout } from '../models/Deal';
import { clientRepository, propertyRepository } from '../repositories/entityRepositories';
import { memberRepository } from '../repositories/memberRepository';
import { createTenantRepository, type Filter } from '../repositories/tenantRepository';
import type { AuthContext, RequestMeta, TenantContext } from '../types/context';
import { AppError, badRequest, forbidden, notFound } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { escapeRegex, searchBlob } from '../utils/text';
import { withTransaction } from '../utils/transaction';
import { activityService, type ActivityRef } from './activityService';
import { auditService } from './auditService';
import { publishChange } from './publish';
import { settingsService } from './settingsService';

export const dealRepository = createTenantRepository<DealDoc>(Deal, ERROR_CODES.DEAL_NOT_FOUND);

export const formatDealNo = (n: number) => `DL-${String(n).padStart(6, '0')}`;

interface Term {
  mode: CommissionMode;
  value: number;
}

export interface DealInput {
  uuid?: string;
  branchId?: string;
  title?: string;
  clientId: string;
  propertyId?: string | null;
  agents?: { userId: string; sharePct: number }[];
  stage?: DealStage;
  lostReason?: string;
  agreedPrice?: number;
  finalPrice?: number;
  expectedCloseDate?: Date | null;
  notes?: string;
  commission?: { buyer?: Term; seller?: Term };
  /** Full lists, used by offline sync (each item keeps its id, so replays never duplicate). */
  payments?: PaymentInput[];
  payouts?: PayoutInput[];
}

export interface PaymentInput {
  id?: string;
  _id?: string;
  side: DealSide;
  amount: number;
  date: Date;
  method?: PaymentMethod;
  reference?: string;
  notes?: string;
}

export interface PayoutInput {
  id?: string;
  _id?: string;
  userId: string;
  amount: number;
  date?: Date | null;
  status?: PayoutStatus;
  notes?: string;
}

export interface DealQuery {
  q?: string;
  stage?: DealStage;
  open?: boolean;
  agentId?: string;
  clientId?: string;
  propertyId?: string;
  commissionStatus?: CommissionStatus;
  branchId?: string;
  from?: Date;
  to?: Date;
  sort?: string;
  page: number;
  limit: number;
}

const SORTS: Record<string, Record<string, 1 | -1>> = {
  '-updatedAt': { updatedAt: -1, _id: -1 },
  '-createdAt': { createdAt: -1, _id: -1 },
  '-expectedTotal': { expectedTotal: -1, _id: -1 },
  '-outstanding': { outstanding: -1, _id: -1 },
  dealNo: { dealNo: 1 },
};

const EDITABLE = ['branchId', 'title', 'clientId', 'propertyId', 'agents', 'agreedPrice', 'finalPrice', 'expectedCloseDate', 'notes', 'commission'] as const;

/** Without deals:read_all a member only sees (and changes) deals they are an agent on. */
export function ownDealsFilter(auth: { permissions?: readonly string[]; userId: string }): Filter {
  return auth.permissions?.includes(PERMISSIONS.DEALS_READ_ALL) ? {} : { 'agents.userId': new Types.ObjectId(auth.userId) };
}

/** The denormalised commission figures stored on the deal (lists, filters, reports). */
function moneyFields(d: Pick<DealDoc, 'agreedPrice' | 'finalPrice' | 'commission' | 'agents' | 'payments' | 'payouts'>) {
  const s = summarizeCommission(d);
  return { expectedTotal: s.expected.total, receivedTotal: s.received.total, outstanding: s.outstanding, commissionStatus: s.status };
}

function refs(deal: Pick<DealDoc, '_id' | 'dealNo' | 'clientId' | 'propertyId'>): ActivityRef[] {
  const r: ActivityRef[] = [{ entityType: 'deal', entityId: deal._id, label: deal.dealNo }, { entityType: 'client', entityId: deal.clientId }];
  if (deal.propertyId) r.push({ entityType: 'property', entityId: deal.propertyId });
  return r;
}

async function assertAgents(ctx: TenantContext, agents: { userId: string; sharePct: number }[]) {
  if (!sharesValid(agents)) throw badRequest(ERROR_CODES.INVALID_AGENT_SHARES, 'Agent shares must add up to 100%');
  if (new Set(agents.map((a) => a.userId)).size !== agents.length) throw badRequest(ERROR_CODES.INVALID_AGENT_SHARES, 'An agent is listed twice');
  for (const a of agents) {
    if (!(await memberRepository.isActiveMemberUser(ctx, a.userId))) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'An agent is not an active member of this business');
  }
}

function normalizePayments(list: PaymentInput[], auth: AuthContext, existing: DealPayment[] = []): DealPayment[] {
  const byId = new Map(existing.map((p) => [p._id, p]));
  return list.map((p) => {
    const id = p._id ?? p.id ?? randomUUID();
    const prev = byId.get(id);
    return {
      _id: id,
      side: p.side,
      amount: p.amount,
      date: new Date(p.date),
      method: p.method ?? 'CASH',
      reference: p.reference,
      notes: p.notes,
      transactionId: prev?.transactionId ?? null,
      createdBy: prev?.createdBy ?? new Types.ObjectId(auth.userId),
    };
  });
}

function normalizePayouts(list: PayoutInput[]): DealPayout[] {
  return list.map((p) => ({
    _id: p._id ?? p.id ?? randomUUID(),
    userId: new Types.ObjectId(p.userId),
    amount: p.amount,
    date: p.date ? new Date(p.date) : null,
    status: p.status ?? 'PENDING',
    notes: p.notes,
  }));
}

const canManageMoney = (auth: AuthContext) => auth.permissions.includes(PERMISSIONS.COMMISSIONS_MANAGE);

/**
 * Hooks for income tracking (B2). The transaction service registers itself here, so deals do not
 * import it (it imports deals for its own links).
 */
export const dealHooks = {
  onPaymentsChanged: async (_auth: AuthContext, _deal: DealDoc, _added: DealPayment[], _removed: DealPayment[]): Promise<void> => undefined,
};

export const dealService = {
  async create(auth: AuthContext, input: DealInput, meta: RequestMeta = {}): Promise<DealDoc> {
    if (input.uuid) {
      const existing = await dealRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    const client = await clientRepository.findById(auth, input.clientId);
    if (!client) throw badRequest(ERROR_CODES.CLIENT_NOT_FOUND, 'Client not found');
    if (input.propertyId && !(await propertyRepository.findById(auth, input.propertyId))) throw badRequest(ERROR_CODES.PROPERTY_NOT_FOUND, 'Property not found');
    const agents = input.agents?.length ? input.agents : [{ userId: auth.userId, sharePct: 100 }];
    await assertAgents(auth, agents);
    if (!auth.permissions.includes(PERMISSIONS.DEALS_READ_ALL) && !agents.some((a) => a.userId === auth.userId)) {
      throw forbidden(ERROR_CODES.FORBIDDEN, 'Add yourself as an agent, or ask for permission to see all deals');
    }
    const settings = await settingsService.get(auth);
    const commission = {
      buyer: input.commission?.buyer ?? { mode: 'PERCENT' as const, value: settings.commission.defaultBuyerPct },
      seller: input.commission?.seller ?? { mode: 'PERCENT' as const, value: settings.commission.defaultSellerPct },
    };
    const payments = input.payments?.length && canManageMoney(auth) ? normalizePayments(input.payments, auth) : [];
    const payouts = input.payouts?.length && canManageMoney(auth) ? normalizePayouts(input.payouts) : [];
    const stage = input.stage ?? 'INQUIRY';
    const now = new Date();
    const base = { agreedPrice: input.agreedPrice, finalPrice: input.finalPrice, commission, agents: agents as never, payments, payouts };

    const deal = await withTransaction(async (session) => {
      const dealNo = formatDealNo(await nextSequence(auth.businessId, 'deal', session));
      return dealRepository.create(
        auth,
        {
          ...(input.uuid ? { uuid: input.uuid } : {}),
          branchId: input.branchId ?? client.branchId,
          dealNo,
          title: input.title,
          clientId: client._id,
          propertyId: input.propertyId ?? null,
          agents,
          stage,
          lostReason: stage === 'CLOSED_LOST' ? input.lostReason : undefined,
          stageHistory: [{ stage, at: now, by: auth.userId }],
          agreedPrice: input.agreedPrice,
          finalPrice: input.finalPrice,
          expectedCloseDate: input.expectedCloseDate ?? null,
          closedAt: stage === 'CLOSED_WON' || stage === 'CLOSED_LOST' ? now : null,
          notes: input.notes,
          commission,
          payments,
          payouts,
          ...moneyFields(base as never),
          searchText: searchBlob(dealNo, input.title, client.fullName),
        },
        session,
      );
    });

    await activityService.record(auth, 'DEAL_CREATED', `Deal ${deal.dealNo} started with ${client.fullName}`, refs(deal), { stage });
    await auditService.record(auth, { action: 'deal.created', entityType: 'deal', entityId: deal._id, entityLabel: deal.dealNo, ip: meta.ip });
    publishChange(auth, SOCKET_EVENTS.DEAL_CREATED, 'deal', deal);
    if (payments.length) await dealHooks.onPaymentsChanged(auth, deal, deal.payments, []);
    return (await dealRepository.findById(auth, deal._id.toString())) ?? deal;
  },

  async list(auth: AuthContext, q: DealQuery) {
    const filter: Filter = { ...ownDealsFilter(auth) };
    const and: Filter[] = [];
    if (q.q) {
      const id = /^(dl-?)?\d{1,6}$/i.test(q.q.trim()) ? formatDealNo(parseInt(q.q.replace(/\D/g, ''), 10)) : null;
      if (id) filter.dealNo = id;
      else for (const t of searchBlob(q.q).split(' ').filter(Boolean)) and.push({ searchText: new RegExp(`(^|\\s)${escapeRegex(t)}`) });
    }
    if (q.stage) filter.stage = q.stage;
    else if (q.open !== undefined) filter.stage = q.open ? { $in: OPEN_DEAL_STAGES } : { $in: ['CLOSED_WON', 'CLOSED_LOST'] };
    if (q.agentId) and.push({ 'agents.userId': new Types.ObjectId(q.agentId) });
    if (q.clientId) filter.clientId = q.clientId;
    if (q.propertyId) filter.propertyId = q.propertyId;
    if (q.commissionStatus) filter.commissionStatus = q.commissionStatus;
    if (q.branchId) filter.branchId = q.branchId;
    if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    if (and.length) filter.$and = and;
    return dealRepository.list(auth, filter, {
      page: q.page,
      limit: q.limit,
      sort: SORTS[q.sort ?? '-updatedAt'] ?? SORTS['-updatedAt'],
      populate: [
        { path: 'clientId', select: 'fullName mobileNumber whatsappNumber' },
        { path: 'propertyId', select: 'propertyId propertyType society area block size sizeUnit askingPrice coverThumbnailUrl' },
        { path: 'agents.userId', select: 'fullName' },
      ],
    });
  },

  /** A deal the user may see (404 otherwise, never 403, so ids don't leak). */
  async load(auth: AuthContext, id: string): Promise<DealDoc> {
    const d = await dealRepository.findOne(auth, { _id: id, ...ownDealsFilter(auth) });
    if (!d) throw notFound(ERROR_CODES.DEAL_NOT_FOUND, 'Deal not found');
    return d;
  },

  async get(auth: AuthContext, id: string) {
    await this.load(auth, id);
    const d = await Deal.findOne({ businessId: auth.businessId, _id: id })
      .populate({ path: 'clientId', select: 'fullName mobileNumber whatsappNumber email', options: { skipTenantGuard: true } })
      .populate({ path: 'propertyId', select: 'propertyId propertyType listingPurpose society area block plotNumber size sizeUnit askingPrice coverThumbnailUrl ownerId', options: { skipTenantGuard: true } })
      .populate({ path: 'agents.userId', select: 'fullName mobileNumber' })
      .populate({ path: 'stageHistory.by', select: 'fullName' })
      .lean<DealDoc>();
    return { ...d!, summary: summarizeCommission(d! as never) };
  },

  async update(auth: AuthContext, id: string, input: Partial<DealInput>, opts: { baseVersion?: number; meta?: RequestMeta } = {}): Promise<DealDoc> {
    const before = await this.load(auth, id);
    if (input.stage && input.stage !== before.stage) {
      await this.changeStage(auth, id, input.stage, { lostReason: input.lostReason, baseVersion: opts.baseVersion });
      opts = { ...opts, baseVersion: undefined };
    }
    const set: Filter = {};
    for (const k of EDITABLE) if (input[k] !== undefined) set[k] = input[k];
    if (set.clientId && String(set.clientId) !== String(before.clientId) && !(await clientRepository.findById(auth, String(set.clientId)))) {
      throw badRequest(ERROR_CODES.CLIENT_NOT_FOUND, 'Client not found');
    }
    if (set.propertyId && !(await propertyRepository.findById(auth, String(set.propertyId)))) throw badRequest(ERROR_CODES.PROPERTY_NOT_FOUND, 'Property not found');
    if (input.agents) {
      await assertAgents(auth, input.agents);
      if (!auth.permissions.includes(PERMISSIONS.DEALS_READ_ALL) && !input.agents.some((a) => a.userId === auth.userId)) {
        throw forbidden(ERROR_CODES.FORBIDDEN, 'You cannot remove yourself from the deal');
      }
    }
    if (input.commission) set.commission = { buyer: input.commission.buyer ?? before.commission.buyer, seller: input.commission.seller ?? before.commission.seller };
    let added: DealPayment[] = [];
    let removed: DealPayment[] = [];
    if (input.payments || input.payouts) {
      if (!canManageMoney(auth)) throw forbidden(ERROR_CODES.FORBIDDEN, 'You cannot record commission payments');
      if (input.payments) {
        const next = normalizePayments(input.payments, auth, before.payments);
        const ids = new Set(before.payments.map((p) => p._id));
        added = next.filter((p) => !ids.has(p._id));
        removed = before.payments.filter((p) => !next.some((n) => n._id === p._id));
        set.payments = next;
      }
      if (input.payouts) set.payouts = normalizePayouts(input.payouts);
    }
    const merged = { ...before, ...set } as DealDoc;
    Object.assign(set, moneyFields(merged));
    if (set.clientId || set.title) {
      const client = await clientRepository.findById(auth, String(merged.clientId));
      set.searchText = searchBlob(before.dealNo, merged.title, client?.fullName);
    }
    const updated = await dealRepository.update(auth, id, set, { baseVersion: opts.baseVersion });
    const changes = diffFields(before as unknown as Record<string, unknown>, set, [...EDITABLE, 'payments', 'payouts']);
    if (changes.length) {
      await auditService.record(auth, { action: 'deal.updated', entityType: 'deal', entityId: updated._id, entityLabel: updated.dealNo, changes, ip: opts.meta?.ip });
      await activityService.record(auth, 'DEAL_UPDATED', `Deal ${updated.dealNo} updated (${changes.map((c) => c.field).join(', ')})`, refs(updated));
    }
    publishChange(auth, SOCKET_EVENTS.DEAL_UPDATED, 'deal', updated);
    if (added.length || removed.length) await dealHooks.onPaymentsChanged(auth, updated, added, removed);
    return (await dealRepository.findById(auth, id)) ?? updated;
  },

  async changeStage(auth: AuthContext, id: string, stage: DealStage, opts: { note?: string; lostReason?: string; baseVersion?: number; meta?: RequestMeta } = {}) {
    const before = await this.load(auth, id);
    if (stage === before.stage) return before;
    if (stage === 'CLOSED_LOST' && !opts.lostReason?.trim()) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Give a reason the deal was lost');
    const closed = stage === 'CLOSED_WON' || stage === 'CLOSED_LOST';
    const updated = await Deal.findOneAndUpdate(
      { businessId: auth.businessId, _id: id, deletedAt: null, ...(opts.baseVersion !== undefined ? { version: opts.baseVersion } : {}) },
      {
        $set: { stage, closedAt: closed ? new Date() : null, lostReason: stage === 'CLOSED_LOST' ? opts.lostReason : undefined, updatedBy: auth.userId },
        $push: { stageHistory: { stage, at: new Date(), by: auth.userId, note: opts.note } },
        $inc: { version: 1 },
      },
      { new: true },
    ).lean<DealDoc>();
    if (!updated) throw new AppError(409, ERROR_CODES.VERSION_CONFLICT, 'This deal was modified by someone else');
    await activityService.record(auth, 'DEAL_STAGE_CHANGED', `Deal ${updated.dealNo}: ${before.stage} → ${stage}${opts.note ? ` (${opts.note})` : ''}`, refs(updated), { from: before.stage, to: stage });
    await auditService.record(auth, { action: 'deal.stage_changed', entityType: 'deal', entityId: updated._id, entityLabel: updated.dealNo, changes: [{ field: 'stage', oldValue: before.stage, newValue: stage }], ip: opts.meta?.ip });
    publishChange(auth, SOCKET_EVENTS.DEAL_UPDATED, 'deal', updated);
    return updated;
  },

  async addPayment(auth: AuthContext, id: string, p: PaymentInput, meta: RequestMeta = {}) {
    const before = await this.load(auth, id);
    const payment = normalizePayments([p], auth)[0];
    if (before.payments.some((x) => x._id === payment._id)) return before; // replay
    const payments = [...before.payments, payment];
    const updated = await dealRepository.update(auth, id, { payments, ...moneyFields({ ...before, payments }) });
    await activityService.record(auth, 'COMMISSION_RECEIVED', `Commission received on ${updated.dealNo}: Rs ${payment.amount.toLocaleString('en-PK')} (${payment.side.toLowerCase()} side)`, refs(updated), { amount: payment.amount, side: payment.side });
    await auditService.record(auth, { action: 'deal.payment_added', entityType: 'deal', entityId: updated._id, entityLabel: updated.dealNo, meta: { paymentId: payment._id, amount: payment.amount, side: payment.side }, ip: meta.ip });
    publishChange(auth, SOCKET_EVENTS.DEAL_UPDATED, 'deal', updated);
    await dealHooks.onPaymentsChanged(auth, updated, [payment], []);
    return (await dealRepository.findById(auth, id)) ?? updated;
  },

  async removePayment(auth: AuthContext, id: string, paymentId: string, meta: RequestMeta = {}) {
    const before = await this.load(auth, id);
    const gone = before.payments.find((x) => x._id === paymentId);
    if (!gone) throw notFound(ERROR_CODES.PAYMENT_NOT_FOUND, 'Payment not found');
    const payments = before.payments.filter((x) => x._id !== paymentId);
    const updated = await dealRepository.update(auth, id, { payments, ...moneyFields({ ...before, payments }) });
    await activityService.record(auth, 'COMMISSION_PAYMENT_REMOVED', `Commission payment of Rs ${gone.amount.toLocaleString('en-PK')} removed from ${updated.dealNo}`, refs(updated));
    await auditService.record(auth, { action: 'deal.payment_removed', entityType: 'deal', entityId: updated._id, entityLabel: updated.dealNo, meta: { paymentId, amount: gone.amount }, ip: meta.ip });
    publishChange(auth, SOCKET_EVENTS.DEAL_UPDATED, 'deal', updated);
    await dealHooks.onPaymentsChanged(auth, updated, [], [gone]);
    return updated;
  },

  async addPayout(auth: AuthContext, id: string, p: PayoutInput, meta: RequestMeta = {}) {
    const before = await this.load(auth, id);
    if (!before.agents.some((a) => String(a.userId) === p.userId)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Payouts go to an agent on this deal');
    const payout = normalizePayouts([p])[0];
    if (before.payouts.some((x) => x._id === payout._id)) return before;
    const payouts = [...before.payouts, payout];
    const updated = await dealRepository.update(auth, id, { payouts });
    await activityService.record(auth, 'COMMISSION_PAYOUT', `Payout of Rs ${payout.amount.toLocaleString('en-PK')} to an agent on ${updated.dealNo} (${payout.status.toLowerCase()})`, refs(updated), { amount: payout.amount, status: payout.status });
    await auditService.record(auth, { action: 'deal.payout_added', entityType: 'deal', entityId: updated._id, entityLabel: updated.dealNo, meta: { payoutId: payout._id, amount: payout.amount }, ip: meta.ip });
    publishChange(auth, SOCKET_EVENTS.DEAL_UPDATED, 'deal', updated);
    return updated;
  },

  async updatePayout(auth: AuthContext, id: string, payoutId: string, p: Partial<PayoutInput>, meta: RequestMeta = {}) {
    const before = await this.load(auth, id);
    const old = before.payouts.find((x) => x._id === payoutId);
    if (!old) throw notFound(ERROR_CODES.PAYMENT_NOT_FOUND, 'Payout not found');
    const next = { ...old, ...(p.amount !== undefined ? { amount: p.amount } : {}), ...(p.status ? { status: p.status } : {}), ...(p.notes !== undefined ? { notes: p.notes } : {}), ...(p.date !== undefined ? { date: p.date ? new Date(p.date) : null } : {}) };
    if (p.status === 'PAID' && !next.date) next.date = new Date();
    const payouts = before.payouts.map((x) => (x._id === payoutId ? next : x));
    const updated = await dealRepository.update(auth, id, { payouts });
    await auditService.record(auth, { action: 'deal.payout_updated', entityType: 'deal', entityId: updated._id, entityLabel: updated.dealNo, changes: diffFields(old as never, next as never, ['amount', 'status', 'date']), ip: meta.ip });
    if (p.status === 'PAID' && old.status !== 'PAID') {
      await activityService.record(auth, 'COMMISSION_PAYOUT', `Agent paid Rs ${next.amount.toLocaleString('en-PK')} on ${updated.dealNo}`, refs(updated), { amount: next.amount, status: 'PAID' });
    }
    publishChange(auth, SOCKET_EVENTS.DEAL_UPDATED, 'deal', updated);
    return updated;
  },

  async remove(auth: AuthContext, id: string, opts: { baseVersion?: number; meta?: RequestMeta } = {}) {
    const before = await this.load(auth, id);
    const deleted = await dealRepository.softDelete(auth, id, { baseVersion: opts.baseVersion });
    await activityService.record(auth, 'DEAL_DELETED', `Deal ${deleted.dealNo} deleted`, refs(deleted));
    await auditService.record(auth, { action: 'deal.deleted', entityType: 'deal', entityId: deleted._id, entityLabel: deleted.dealNo, ip: opts.meta?.ip });
    publishChange(auth, SOCKET_EVENTS.DEAL_DELETED, 'deal', deleted);
    if (before.payments.length) await dealHooks.onPaymentsChanged(auth, deleted, [], before.payments);
    return deleted;
  },

  /** Dashboard tiles: open deals, deals won and commission received this month, outstanding commission. */
  async stats(auth: AuthContext) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const own = ownDealsFilter(auth);
    const [open, wonThisMonth, rows] = await Promise.all([
      dealRepository.count(auth, { ...own, stage: { $in: OPEN_DEAL_STAGES } }),
      dealRepository.count(auth, { ...own, stage: 'CLOSED_WON', closedAt: { $gte: monthStart } }),
      dealRepository.find(auth, { ...own, stage: { $ne: 'CLOSED_LOST' } }, { select: 'outstanding payments.amount payments.date' }),
    ]);
    const receivedThisMonth = rows.reduce((s, d) => s + d.payments.filter((p) => new Date(p.date) >= monthStart).reduce((t, p) => t + p.amount, 0), 0);
    const outstanding = rows.reduce((s, d) => s + (d.outstanding ?? 0), 0);
    return { open, wonThisMonth, receivedThisMonth, outstanding };
  },

  /**
   * Commission report: received by month or by agent (from payments, so it is what actually came
   * in), plus expected / received / outstanding totals and the deals still owing commission.
   */
  async report(auth: AuthContext, q: { groupBy: 'month' | 'agent'; from?: Date; to?: Date }) {
    const deals = await dealRepository.find(auth, { ...ownDealsFilter(auth), stage: { $ne: 'CLOSED_LOST' } }, { select: 'dealNo title clientId stage agents payments expectedTotal receivedTotal outstanding commissionStatus finalPrice agreedPrice commission' });
    const inRange = (d: Date) => (!q.from || d >= q.from) && (!q.to || d <= q.to);
    const rows = new Map<string, { key: string; received: number; payments: number }>();
    for (const d of deals) {
      for (const p of d.payments.filter((x) => inRange(new Date(x.date)))) {
        if (q.groupBy === 'month') {
          const key = new Date(p.date).toISOString().slice(0, 7);
          const r = rows.get(key) ?? { key, received: 0, payments: 0 };
          r.received += p.amount;
          r.payments += 1;
          rows.set(key, r);
        } else {
          for (const a of d.agents) {
            const key = String(a.userId);
            const r = rows.get(key) ?? { key, received: 0, payments: 0 };
            r.received += Math.round((p.amount * a.sharePct) / 100);
            r.payments += 1;
            rows.set(key, r);
          }
        }
      }
    }
    let labels: Record<string, string> = {};
    if (q.groupBy === 'agent' && rows.size) {
      const { User } = await import('../models/User');
      const users = await User.find({ _id: { $in: [...rows.keys()] } }).select('fullName').lean();
      labels = Object.fromEntries(users.map((u) => [String(u._id), u.fullName]));
    }
    const totals = deals.reduce((t, d) => ({ expected: t.expected + d.expectedTotal, received: t.received + d.receivedTotal, outstanding: t.outstanding + d.outstanding }), { expected: 0, received: 0, outstanding: 0 });
    const outstanding = deals
      .filter((d) => d.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 50)
      .map((d) => ({ _id: d._id, dealNo: d.dealNo, title: d.title, stage: d.stage, expectedTotal: d.expectedTotal, receivedTotal: d.receivedTotal, outstanding: d.outstanding }));
    return {
      groupBy: q.groupBy,
      rows: [...rows.values()].map((r) => ({ ...r, label: q.groupBy === 'agent' ? (labels[r.key] ?? '—') : r.key })).sort((a, b) => (q.groupBy === 'month' ? a.key.localeCompare(b.key) : b.received - a.received)),
      totals,
      outstanding,
    };
  },
};
