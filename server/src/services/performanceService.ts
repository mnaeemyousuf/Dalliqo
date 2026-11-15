import { Types } from 'mongoose';
import { PERMISSIONS } from '@recrm/shared';
import { Branch } from '../models/Branch';
import { BusinessMember } from '../models/BusinessMember';
import { Client } from '../models/Client';
import { Deal } from '../models/Deal';
import { FollowUp } from '../models/FollowUp';
import { Property } from '../models/Property';
import { Transaction } from '../models/Transaction';
import { User } from '../models/User';
import type { AuthContext } from '../types/context';
import { forbidden } from '../utils/AppError';
import { branchFilter } from './branchScope';

export interface PeriodFilter {
  from?: Date;
  to?: Date;
  branchId?: string;
  agentId?: string;
  propertyType?: string;
}

const DAY = 86_400_000;
/** A date-only 'to' (midnight) means the whole of that day. */
export const endOfDay = (d: Date) => (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0 ? new Date(d.getTime() + 86_400_000 - 1) : d);
function period(q: PeriodFilter) {
  const to = q.to ? endOfDay(new Date(q.to)) : new Date();
  const from = q.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  return { from, to };
}
/** Branch scope of the user, narrowed to one branch when asked (never widened). */
function scope(auth: AuthContext, branchId?: string): Record<string, unknown> {
  const own = branchFilter(auth) as { branchId?: { $in: unknown[] } };
  if (!branchId) return { ...own };
  if (own.branchId && !own.branchId.$in.map(String).includes(branchId)) return { branchId: { $in: [] } };
  return { branchId: new Types.ObjectId(branchId) };
}

export interface AgentPerformanceRow {
  userId: string;
  fullName: string;
  leadsAssigned: number;
  leadsContacted: number;
  followUpsCompleted: number;
  siteVisits: number;
  negotiations: number;
  dealsClosed: number;
  commission: number;
  conversionPct: number | null;
  avgResponseMinutes: number | null;
}

export const performanceService = {
  /** Per-agent activity and results for a period (managers: everyone in scope; others: themselves). */
  async agents(auth: AuthContext, q: PeriodFilter): Promise<{ from: Date; to: Date; rows: AgentPerformanceRow[] }> {
    const { from, to } = period(q);
    const bid = new Types.ObjectId(auth.businessId);
    const all = auth.permissions.includes(PERMISSIONS.DEALS_READ_ALL) || auth.permissions.includes(PERMISSIONS.MEMBERS_READ);
    if (!all && q.agentId && q.agentId !== auth.userId) throw forbidden();
    const members = await BusinessMember.find({ businessId: bid, status: 'ACTIVE', ...(all ? (q.agentId ? { userId: new Types.ObjectId(q.agentId) } : {}) : { userId: new Types.ObjectId(auth.userId) }) }).select('userId').lean();
    const ids = members.map((m) => m.userId);
    const base = { businessId: bid, deletedAt: null, ...scope(auth, q.branchId) };
    const range = { $gte: from, $lte: to };
    const [assigned, contacted, response, done, visits, deals, users] = await Promise.all([
      Client.aggregate<{ _id: Types.ObjectId; n: number; won: number }>([{ $match: { ...base, assignedTo: { $in: ids }, createdAt: range } }, { $group: { _id: '$assignedTo', n: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'CLOSED_WON'] }, 1, 0] } } } }]),
      Client.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { ...base, assignedTo: { $in: ids }, lastContactedAt: range } }, { $group: { _id: '$assignedTo', n: { $sum: 1 } } }]),
      Client.aggregate<{ _id: Types.ObjectId; avg: number }>([{ $match: { ...base, assignedTo: { $in: ids }, firstContactedAt: range, responseMinutes: { $ne: null } } }, { $group: { _id: '$assignedTo', avg: { $avg: '$responseMinutes' } } }]),
      FollowUp.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { ...base, assignedTo: { $in: ids }, status: 'COMPLETED', completedAt: range } }, { $group: { _id: '$assignedTo', n: { $sum: 1 } } }]),
      FollowUp.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { ...base, assignedTo: { $in: ids }, type: 'PROPERTY_VISIT', status: 'COMPLETED', completedAt: range } }, { $group: { _id: '$assignedTo', n: { $sum: 1 } } }]),
      Deal.find({ ...base, 'agents.userId': { $in: ids }, $or: [{ 'stageHistory.at': range }, { 'payments.date': range }] }).select('agents stage stageHistory payments closedAt').lean(),
      User.find({ _id: { $in: ids } }).select('fullName').lean(),
    ]);
    const get = (rows: { _id: Types.ObjectId; n: number }[], id: string) => rows.find((r) => String(r._id) === id)?.n ?? 0;
    const rows = ids.map((uid) => {
      const id = String(uid);
      let negotiations = 0;
      let dealsClosed = 0;
      let commission = 0;
      for (const d of deals) {
        const share = d.agents.find((a) => String(a.userId) === id);
        if (!share) continue;
        if (d.stageHistory.some((h) => h.stage === 'NEGOTIATION' && h.at >= from && h.at <= to)) negotiations++;
        if (d.stage === 'CLOSED_WON' && d.closedAt && d.closedAt >= from && d.closedAt <= to) dealsClosed++;
        commission += Math.round((d.payments.filter((p) => p.date >= from && p.date <= to).reduce((s, p) => s + p.amount, 0) * share.sharePct) / 100);
      }
      const a = assigned.find((r) => String(r._id) === id);
      const avg = response.find((r) => String(r._id) === id)?.avg;
      return {
        userId: id,
        fullName: users.find((u) => String(u._id) === id)?.fullName ?? '',
        leadsAssigned: a?.n ?? 0,
        leadsContacted: get(contacted, id),
        followUpsCompleted: get(done, id),
        siteVisits: get(visits, id),
        negotiations,
        dealsClosed,
        commission,
        conversionPct: a?.n ? Math.round(((a.won ?? 0) / a.n) * 1000) / 10 : null,
        avgResponseMinutes: avg !== undefined && avg !== null ? Math.round(avg) : null,
      };
    });
    rows.sort((x, y) => y.commission - x.commission || y.dealsClosed - x.dealsClosed);
    return { from, to, rows };
  },

  /** Owner view for a period: inventory, leads, deals, money, closing time — all from records. */
  async business(auth: AuthContext, q: PeriodFilter) {
    if (!auth.permissions.includes(PERMISSIONS.REPORTS_READ)) throw forbidden();
    const { from, to } = period(q);
    const bid = new Types.ObjectId(auth.businessId);
    const base = { businessId: bid, deletedAt: null, ...scope(auth, q.branchId) };
    const range = { $gte: from, $lte: to };
    const typeFilter = q.propertyType ? { propertyType: q.propertyType } : {};
    const [props, active, verified, newLeads, activeClients, openDeals, won, money, aging] = await Promise.all([
      Property.countDocuments({ ...base, ...typeFilter }),
      Property.countDocuments({ ...base, ...typeFilter, status: { $in: ['AVAILABLE', 'RESERVED', 'UNDER_NEGOTIATION'] } }),
      Property.countDocuments({ ...base, ...typeFilter, 'verification.status': 'APPROVED' }),
      Client.countDocuments({ ...base, createdAt: range }),
      Client.countDocuments({ ...base, status: 'ACTIVE' }),
      Deal.find({ ...base, stage: { $nin: ['CLOSED_WON', 'CLOSED_LOST'] } }).select('expectedTotal receivedTotal outstanding').lean(),
      Deal.find({ ...base, stage: 'CLOSED_WON', closedAt: range }).select('finalPrice agreedPrice createdAt closedAt expectedTotal receivedTotal').lean(),
      Transaction.aggregate<{ _id: string; total: number }>([{ $match: { ...base, date: range } }, { $group: { _id: '$type', total: { $sum: '$amount' } } }]),
      Property.aggregate<{ _id: null; avgDays: number; over90: number }>([
        { $match: { ...base, ...typeFilter, status: 'AVAILABLE' } },
        { $project: { days: { $divide: [{ $subtract: [new Date(), '$createdAt'] }, DAY] } } },
        { $group: { _id: null, avgDays: { $avg: '$days' }, over90: { $sum: { $cond: [{ $gt: ['$days', 90] }, 1, 0] } } } },
      ]),
    ]);
    const income = money.find((m) => m._id === 'INCOME')?.total ?? 0;
    const expense = money.find((m) => m._id === 'EXPENSE')?.total ?? 0;
    const closeDays = won.filter((d) => d.closedAt).map((d) => (+new Date(d.closedAt!) - +new Date(d.createdAt)) / DAY);
    const convertedLeads = await Client.countDocuments({ ...base, createdAt: range, status: 'CLOSED_WON' });
    return {
      from,
      to,
      properties: { total: props, active, verified, avgDaysOnMarket: aging[0] ? Math.round(aging[0].avgDays) : null, over90Days: aging[0]?.over90 ?? 0 },
      leads: { new: newLeads, activeClients, conversionPct: newLeads ? Math.round((convertedLeads / newLeads) * 1000) / 10 : null },
      deals: {
        active: openDeals.length,
        closed: won.length,
        transactionValue: won.reduce((s, d) => s + (d.finalPrice ?? d.agreedPrice ?? 0), 0),
        avgDaysToClose: closeDays.length ? Math.round(closeDays.reduce((s, x) => s + x, 0) / closeDays.length) : null,
      },
      commission: {
        expected: openDeals.reduce((s, d) => s + (d.expectedTotal ?? 0), 0) + won.reduce((s, d) => s + (d.expectedTotal ?? 0), 0),
        received: won.reduce((s, d) => s + (d.receivedTotal ?? 0), 0) + openDeals.reduce((s, d) => s + (d.receivedTotal ?? 0), 0),
        outstanding: openDeals.reduce((s, d) => s + (d.outstanding ?? 0), 0) + won.reduce((s, d) => s + Math.max(0, (d.expectedTotal ?? 0) - (d.receivedTotal ?? 0)), 0),
      },
      finance: { income, expense, netProfit: income - expense },
    };
  },

  /** Per-branch actuals for the month against the branch's targets. */
  async branches(auth: AuthContext, q: PeriodFilter) {
    if (!auth.permissions.includes(PERMISSIONS.REPORTS_READ)) throw forbidden();
    const { from, to } = period(q);
    const bid = new Types.ObjectId(auth.businessId);
    const own = branchFilter(auth) as { branchId?: { $in: unknown[] } };
    const branches = await Branch.find({ businessId: bid, archivedAt: null, ...(own.branchId ? { _id: own.branchId } : {}) }).select('name targets').lean();
    const ids = branches.map((b) => b._id);
    const range = { $gte: from, $lte: to };
    const [leads, won, pays, money] = await Promise.all([
      Client.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { businessId: bid, deletedAt: null, branchId: { $in: ids }, createdAt: range } }, { $group: { _id: '$branchId', n: { $sum: 1 } } }]),
      Deal.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { businessId: bid, deletedAt: null, branchId: { $in: ids }, stage: 'CLOSED_WON', closedAt: range } }, { $group: { _id: '$branchId', n: { $sum: 1 } } }]),
      Deal.aggregate<{ _id: Types.ObjectId; total: number }>([{ $match: { businessId: bid, deletedAt: null, branchId: { $in: ids } } }, { $unwind: '$payments' }, { $match: { 'payments.date': range } }, { $group: { _id: '$branchId', total: { $sum: '$payments.amount' } } }]),
      Transaction.aggregate<{ _id: { b: Types.ObjectId; t: string }; total: number }>([{ $match: { businessId: bid, deletedAt: null, branchId: { $in: ids }, date: range } }, { $group: { _id: { b: '$branchId', t: '$type' }, total: { $sum: '$amount' } } }]),
    ]);
    const n = (rows: { _id: Types.ObjectId; n?: number; total?: number }[], id: string) => rows.find((r) => String(r._id) === id);
    return {
      from,
      to,
      rows: branches.map((b) => {
        const id = String(b._id);
        const income = money.find((m) => String(m._id.b) === id && m._id.t === 'INCOME')?.total ?? 0;
        const expense = money.find((m) => String(m._id.b) === id && m._id.t === 'EXPENSE')?.total ?? 0;
        const pct = (actual: number, target?: number | null) => (target ? Math.round((actual / target) * 100) : null);
        const L = n(leads, id)?.n ?? 0;
        const W = n(won, id)?.n ?? 0;
        const C = n(pays, id)?.total ?? 0;
        return {
          branchId: id,
          name: b.name,
          leads: L,
          dealsWon: W,
          commission: C,
          income,
          expense,
          net: income - expense,
          targets: b.targets ?? {},
          progress: { leads: pct(L, b.targets?.leads), dealsWon: pct(W, b.targets?.dealsWon), commission: pct(C, b.targets?.commission) },
        };
      }),
    };
  },
};
