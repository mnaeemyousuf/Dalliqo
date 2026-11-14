import { Types } from 'mongoose';
import { OPEN_DEAL_STAGES, PERMISSIONS } from '@recrm/shared';
import { BusinessMember } from '../models/BusinessMember';
import { Client } from '../models/Client';
import { Deal } from '../models/Deal';
import { FollowUp } from '../models/FollowUp';
import { User } from '../models/User';
import type { AuthContext } from '../types/context';
import { forbidden } from '../utils/AppError';
import { branchFilter } from './branchScope';

const DAY = 86_400_000;

export interface TeamRow {
  userId: string;
  fullName: string;
  role: string;
  leads: number;
  hotLeads: number;
  overdueFollowUps: number;
  followUpsDoneThisWeek: number;
  openDeals: number;
  wonThisMonth: number;
  /** Commission received this month on deals the member is an agent on (their share). */
  commissionThisMonth: number;
}

/** Team leaderboard for managers (branch-scoped). One aggregate per collection, not per member. */
export const teamDashboardService = {
  async team(auth: AuthContext): Promise<{ rows: TeamRow[]; totals: Omit<TeamRow, 'userId' | 'fullName' | 'role'> }> {
    if (!auth.permissions.includes(PERMISSIONS.DEALS_READ_ALL) && !auth.permissions.includes(PERMISSIONS.MEMBERS_READ)) throw forbidden();
    const bid = new Types.ObjectId(auth.businessId);
    const scope = { businessId: bid, deletedAt: null, ...branchFilter(auth) };
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const weekAgo = new Date(now.getTime() - 7 * DAY);
    const members = await BusinessMember.find({ businessId: bid, status: 'ACTIVE' }).select('userId role').lean();
    const ids = members.map((m) => m.userId);
    const [users, leads, fups, done, deals] = await Promise.all([
      User.find({ _id: { $in: ids } }).select('fullName').lean(),
      Client.aggregate<{ _id: Types.ObjectId; leads: number; hot: number }>([
        { $match: { ...scope, assignedTo: { $in: ids }, status: 'ACTIVE' } },
        { $group: { _id: '$assignedTo', leads: { $sum: 1 }, hot: { $sum: { $cond: [{ $eq: ['$temperature', 'HOT'] }, 1, 0] } } } },
      ]),
      FollowUp.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { ...scope, assignedTo: { $in: ids }, $or: [{ status: 'OVERDUE' }, { status: 'PENDING', dueAt: { $lt: now } }] } },
        { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
      ]),
      FollowUp.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { ...scope, assignedTo: { $in: ids }, status: 'COMPLETED', completedAt: { $gte: weekAgo } } },
        { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
      ]),
      Deal.find({ ...scope, 'agents.userId': { $in: ids }, $or: [{ stage: { $in: OPEN_DEAL_STAGES } }, { closedAt: { $gte: monthStart } }, { 'payments.date': { $gte: monthStart } }] })
        .select('stage closedAt agents payments')
        .lean(),
    ]);
    const by = <T extends { _id: Types.ObjectId }>(rows: T[]) => new Map(rows.map((r) => [String(r._id), r]));
    const L = by(leads);
    const F = by(fups);
    const D = by(done);
    const rows: TeamRow[] = members.map((m) => {
      const id = String(m.userId);
      let openDeals = 0;
      let wonThisMonth = 0;
      let commissionThisMonth = 0;
      for (const d of deals) {
        const share = d.agents.find((a) => String(a.userId) === id);
        if (!share) continue;
        if ((OPEN_DEAL_STAGES as readonly string[]).includes(d.stage)) openDeals++;
        if (d.stage === 'CLOSED_WON' && d.closedAt && d.closedAt >= monthStart) wonThisMonth++;
        const received = d.payments.filter((p) => new Date(p.date) >= monthStart).reduce((s, p) => s + p.amount, 0);
        commissionThisMonth += Math.round((received * share.sharePct) / 100);
      }
      return {
        userId: id,
        fullName: users.find((u) => String(u._id) === id)?.fullName ?? '',
        role: m.role,
        leads: L.get(id)?.leads ?? 0,
        hotLeads: L.get(id)?.hot ?? 0,
        overdueFollowUps: F.get(id)?.n ?? 0,
        followUpsDoneThisWeek: D.get(id)?.n ?? 0,
        openDeals,
        wonThisMonth,
        commissionThisMonth,
      };
    });
    rows.sort((a, b) => b.commissionThisMonth - a.commissionThisMonth || b.wonThisMonth - a.wonThisMonth || b.openDeals - a.openDeals);
    const sum = (k: keyof TeamRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
    return {
      rows,
      totals: { leads: sum('leads'), hotLeads: sum('hotLeads'), overdueFollowUps: sum('overdueFollowUps'), followUpsDoneThisWeek: sum('followUpsDoneThisWeek'), openDeals: sum('openDeals'), wonThisMonth: sum('wonThisMonth'), commissionThisMonth: sum('commissionThisMonth') },
    };
  },
};
