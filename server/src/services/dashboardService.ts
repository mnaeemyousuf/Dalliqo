import { LISTING_VERIFICATION_STALE_DAYS } from '@recrm/shared';
import { Types, type PipelineStage } from 'mongoose';
import { scopedPopulate } from '../models/plugins/tenant';
import { Business } from '../models/Business';
import { BusinessMember } from '../models/BusinessMember';
import { Client } from '../models/Client';
import { ClientCategory } from '../models/ClientCategory';
import { FollowUp } from '../models/FollowUp';
import { Match } from '../models/Match';
import { Property } from '../models/Property';
import { PropertyOwner } from '../models/PropertyOwner';
import type { TenantContext } from '../types/context';
import { eventBus } from '../utils/eventBus';
import { dayRange } from '../utils/time';

const oid = (id: string) => new Types.ObjectId(id);

async function timezoneOf(ctx: TenantContext): Promise<string> {
  const b = await Business.findById(ctx.businessId).select('timezone').lean();
  return b?.timezone ?? 'Asia/Karachi';
}

function countBy(rows: { _id: unknown; n: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [String(r._id ?? 'NONE'), r.n]));
}

/** Short in-process cache so dashboards refreshed by many devices don't recompute every time. */
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}

export const dashboardService = {
  invalidate(businessId: string) {
    for (const k of cache.keys()) if (k.startsWith(businessId)) cache.delete(k);
  },

  /** All numbers are computed from the database at request time (cached 15 s). */
  summary(ctx: TenantContext) {
    return cached(`${ctx.businessId}:summary`, 15_000, async () => {
      const businessId = oid(ctx.businessId);
      const tz = await timezoneOf(ctx);
      const { start, end } = dayRange(tz);
      const now = new Date();
      const live = { businessId, deletedAt: null };

      const staleCutoff = new Date(now.getTime() - LISTING_VERIFICATION_STALE_DAYS * 86_400_000);
      const [propertyStatus, clientPurpose, owners, categoryRows, todayFollowUps, overdue, newClients, newProperties, newMatches, needsVerification] = await Promise.all([
        Property.aggregate<{ _id: string; n: number }>([{ $match: live }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Client.aggregate<{ _id: string; n: number }>([{ $match: live }, { $group: { _id: '$purchaseOrRental', n: { $sum: 1 } } }]),
        PropertyOwner.countDocuments(live),
        Client.aggregate<{ _id: unknown; n: number }>([{ $match: live }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]),
        FollowUp.countDocuments({ ...live, dueAt: { $gte: start, $lt: end }, status: { $ne: 'CANCELLED' } }),
        FollowUp.countDocuments({ ...live, $or: [{ status: 'OVERDUE' }, { status: 'PENDING', dueAt: { $lt: now } }] }),
        Client.countDocuments({ ...live, createdAt: { $gte: start, $lt: end } }),
        Property.countDocuments({ ...live, createdAt: { $gte: start, $lt: end } }),
        Match.countDocuments({ businessId, createdAt: { $gte: start, $lt: end } }),
        Property.countDocuments({ ...live, status: 'AVAILABLE', $or: [{ lastVerifiedAt: { $lt: staleCutoff } }, { lastVerifiedAt: null }] }),
      ]);
      const categories = await ClientCategory.find({ businessId }).select('name key').lean();
      const catName = new Map(categories.map((c) => [c._id.toString(), { name: c.name, key: c.key }]));
      const status = countBy(propertyStatus);
      const purpose = countBy(clientPurpose);
      const byCategory = categoryRows.map((r) => ({
        categoryId: r._id ? String(r._id) : null,
        name: r._id ? catName.get(String(r._id))?.name ?? 'Unknown' : 'Uncategorised',
        key: r._id ? catName.get(String(r._id))?.key ?? null : null,
        count: r.n,
      }));
      const ownersCategory = byCategory.find((c) => c.key === 'PROPERTY_OWNER')?.count ?? 0;

      return {
        properties: {
          total: Object.values(status).reduce((a, b) => a + b, 0),
          available: status.AVAILABLE ?? 0,
          reserved: status.RESERVED ?? 0,
          sold: status.SOLD ?? 0,
          rented: status.RENTED ?? 0,
          withdrawn: status.WITHDRAWN ?? 0,
          inactive: status.INACTIVE ?? 0,
          needsVerification,
        },
        clients: {
          total: Object.values(purpose).reduce((a, b) => a + b, 0),
          buyers: purpose.PURCHASE ?? 0,
          rental: purpose.RENTAL ?? 0,
          owners: owners + ownersCategory,
          byCategory,
        },
        followUps: { today: todayFollowUps, overdue },
        today: { newClients, newProperties, newMatches },
        generatedAt: new Date(),
        timezone: tz,
      };
    });
  },

  analytics(ctx: TenantContext, range: '7d' | '30d' | '12m') {
    return cached(`${ctx.businessId}:analytics:${range}`, 30_000, async () => {
      const businessId = oid(ctx.businessId);
      const tz = await timezoneOf(ctx);
      const monthly = range === '12m';
      const days = range === '7d' ? 7 : 30;
      const since = monthly ? new Date(Date.now() - 365 * 86_400_000) : new Date(dayRange(tz).start.getTime() - (days - 1) * 86_400_000);
      const fmt = monthly ? '%Y-%m' : '%Y-%m-%d';
      const live = { businessId, deletedAt: null };

      const series = (model: typeof Client | typeof Property | typeof Match, extra: Record<string, unknown> = {}) =>
        (model as typeof Client).aggregate<{ _id: string; n: number }>([
          { $match: { businessId, createdAt: { $gte: since }, ...extra } },
          { $group: { _id: { $dateToString: { format: fmt, date: '$createdAt', timezone: tz } }, n: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ] as PipelineStage[]);

      const [byType, byStatus, byCategory, followUpRows, clientsSeries, propertiesSeries, matchesSeries, bands, sourceRows, teamDone, teamOverdue, teamClients] = await Promise.all([
        Property.aggregate<{ _id: string; n: number }>([{ $match: live }, { $group: { _id: '$propertyType', n: { $sum: 1 } } }]),
        Property.aggregate<{ _id: string; n: number }>([{ $match: live }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Client.aggregate<{ _id: unknown; n: number }>([{ $match: live }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]),
        FollowUp.aggregate<{ _id: { period: string; status: string }; n: number }>([
          { $match: { ...live, dueAt: { $gte: since, $lte: new Date() } } },
          { $group: { _id: { period: { $dateToString: { format: fmt, date: '$dueAt', timezone: tz } }, status: '$status' }, n: { $sum: 1 } } },
          { $sort: { '_id.period': 1 } },
        ]),
        series(Client, { deletedAt: null }),
        series(Property, { deletedAt: null }),
        series(Match),
        Match.aggregate<{ _id: string; n: number }>([{ $match: { businessId, status: { $ne: 'STALE' } } }, { $group: { _id: '$band', n: { $sum: 1 } } }]),
        // Lead sources with their outcome, for a simple conversion view.
        Client.aggregate<{ _id: { source: string | null; status: string }; n: number }>([
          { $match: live },
          { $group: { _id: { source: '$source', status: '$status' }, n: { $sum: 1 } } },
        ]),
        // Team accountability: completed follow-ups in the range, open overdue ones now, clients owned.
        FollowUp.aggregate<{ _id: unknown; n: number }>([
          { $match: { ...live, status: 'COMPLETED', completedAt: { $gte: since } } },
          { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
        ]),
        FollowUp.aggregate<{ _id: unknown; n: number }>([
          { $match: { ...live, $or: [{ status: 'OVERDUE' }, { status: 'PENDING', dueAt: { $lt: new Date() } }] } },
          { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
        ]),
        Client.aggregate<{ _id: unknown; n: number }>([{ $match: { ...live, status: 'ACTIVE' } }, { $group: { _id: '$assignedTo', n: { $sum: 1 } } }]),
      ]);

      // Fill every period so charts have continuous axes.
      const periods: string[] = [];
      if (monthly) {
        const d = new Date();
        for (let i = 11; i >= 0; i--) {
          const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
          periods.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`);
        }
      } else {
        const start = dayRange(tz).start.getTime();
        const local = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(t + 3_600_000));
        for (let i = days - 1; i >= 0; i--) periods.push(local(start - i * 86_400_000));
      }
      const toMap = (rows: { _id: string; n: number }[]) => new Map(rows.map((r) => [r._id, r.n]));
      const c = toMap(clientsSeries);
      const p = toMap(propertiesSeries);
      const m = toMap(matchesSeries);
      const fu = new Map<string, Record<string, number>>();
      for (const r of followUpRows) {
        const row = fu.get(r._id.period) ?? {};
        row[r._id.status] = r.n;
        fu.set(r._id.period, row);
      }
      const categories = await ClientCategory.find({ businessId }).select('name').lean();
      const catName = new Map(categories.map((x) => [x._id.toString(), x.name]));

      const sources = new Map<string, { source: string; total: number; won: number; lost: number; active: number }>();
      for (const r of sourceRows) {
        const key = r._id.source ?? 'UNKNOWN';
        const row = sources.get(key) ?? { source: key, total: 0, won: 0, lost: 0, active: 0 };
        row.total += r.n;
        if (r._id.status === 'CLOSED_WON') row.won += r.n;
        else if (r._id.status === 'CLOSED_LOST') row.lost += r.n;
        else if (r._id.status === 'ACTIVE' || r._id.status === 'ON_HOLD') row.active += r.n;
        sources.set(key, row);
      }
      const memberIds = new Set([...teamDone, ...teamOverdue, ...teamClients].map((r) => String(r._id)).filter((id) => id && id !== 'null'));
      const members = memberIds.size
        ? await BusinessMember.find({ businessId, userId: { $in: [...memberIds].map(oid) } }).populate(scopedPopulate('userId', 'fullName')).lean()
        : [];
      const nameOf = new Map(members.map((mm) => [String((mm.userId as unknown as { _id: unknown })._id), (mm.userId as unknown as { fullName: string }).fullName]));
      const count = (rows: { _id: unknown; n: number }[], id: string) => rows.find((r) => String(r._id) === id)?.n ?? 0;

      return {
        range,
        propertyDistribution: byType.map((r) => ({ type: r._id, count: r.n })),
        propertyStatus: byStatus.map((r) => ({ status: r._id, count: r.n })),
        clientCategories: byCategory.map((r) => ({ name: r._id ? catName.get(String(r._id)) ?? 'Unknown' : 'Uncategorised', count: r.n })),
        followUpPerformance: periods.map((period) => ({
          period,
          completed: fu.get(period)?.COMPLETED ?? 0,
          overdue: fu.get(period)?.OVERDUE ?? 0,
          pending: fu.get(period)?.PENDING ?? 0,
          cancelled: fu.get(period)?.CANCELLED ?? 0,
        })),
        newRecords: periods.map((period) => ({ period, clients: c.get(period) ?? 0, properties: p.get(period) ?? 0, matches: m.get(period) ?? 0 })),
        matchQuality: ['EXCELLENT', 'VERY_GOOD', 'GOOD', 'POSSIBLE'].map((band) => ({ band, count: bands.find((b) => b._id === band)?.n ?? 0 })),
        leadSources: [...sources.values()].sort((a, b) => b.total - a.total),
        teamPerformance: [...memberIds]
          .map((id) => ({
            userId: id,
            name: nameOf.get(id) ?? 'Former member',
            followUpsCompleted: count(teamDone, id),
            followUpsOverdue: count(teamOverdue, id),
            activeClients: count(teamClients, id),
          }))
          .sort((a, b) => b.followUpsCompleted - a.followUpsCompleted),
      };
    });
  },

  /** The daily command centre. Defaults to the signed-in user's own work. */
  async myDay(ctx: TenantContext, scope: 'mine' | 'all' = 'mine') {
    const businessId = oid(ctx.businessId);
    const tz = await timezoneOf(ctx);
    const { start, end } = dayRange(tz);
    const now = new Date();
    const live = { businessId, deletedAt: null };
    const mine = scope === 'mine' ? { assignedTo: oid(ctx.userId) } : {};
    const populate = (q: ReturnType<typeof FollowUp.find>) =>
      q.populate(scopedPopulate('clientId', 'fullName mobileNumber whatsappNumber')).populate(scopedPopulate('propertyId', 'propertyId society area propertyType')).populate('assignedTo', 'fullName').lean();
    const open = { status: { $in: ['PENDING', 'OVERDUE'] } };

    const [today, overdue, newClients, newProperties, newMatches] = await Promise.all([
      populate(FollowUp.find({ ...live, ...mine, ...open, dueAt: { $gte: start, $lt: end } }).sort({ dueAt: 1 }).limit(100)),
      populate(FollowUp.find({ ...live, ...mine, ...open, dueAt: { $lt: start } }).sort({ dueAt: 1 }).limit(100)),
      Client.find({ ...live, createdAt: { $gte: start, $lt: end } }).sort({ createdAt: -1 }).limit(20).select('fullName mobileNumber categoryId preferredSociety minBudget maxBudget matchCount').lean(),
      Property.find({ ...live, createdAt: { $gte: start, $lt: end } }).sort({ createdAt: -1 }).limit(20)
        .select('propertyId propertyType society area size sizeUnit askingPrice status matchCount coverThumbnailUrl').lean(),
      Match.find({ businessId, createdAt: { $gte: start, $lt: end }, status: { $ne: 'STALE' } }).sort({ matchScore: -1 }).limit(20)
        .populate(scopedPopulate('clientId', 'fullName mobileNumber whatsappNumber')).populate(scopedPopulate('propertyId', 'propertyId propertyType society area size sizeUnit askingPrice')).lean(),
    ]);
    const isType = (t: string) => (f: { type: string }) => f.type === t;
    return {
      date: start,
      timezone: tz,
      todaysFollowUps: today.filter((f) => !['MEETING', 'PROPERTY_VISIT'].includes(f.type)),
      overdueFollowUps: overdue,
      todaysMeetings: today.filter(isType('MEETING')),
      propertyVisits: today.filter(isType('PROPERTY_VISIT')),
      newClients,
      newProperties,
      newMatches,
    };
  },
};

// Any committed change in a business invalidates its cached dashboard numbers.
eventBus.subscribe((e) => dashboardService.invalidate(e.businessId));
