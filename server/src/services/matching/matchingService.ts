import { Types } from 'mongoose';
import { scopedPopulate } from '../../models/plugins/tenant';
import { ERROR_CODES, SOCKET_EVENTS, type MatchStatus, type PropertyType } from '@recrm/shared';
import { logger } from '../../config/logger';
import type { ClientDoc, RequirementDoc } from '../../models/Client';
import { Client } from '../../models/Client';
import { Match, type MatchDoc } from '../../models/Match';
import { Property, type PropertyDoc } from '../../models/Property';
import { memberRepository } from '../../repositories/memberRepository';
import type { TenantContext } from '../../types/context';
import { notFound } from '../../utils/AppError';
import { eventBus } from '../../utils/eventBus';
import { formatPkr } from '../../utils/text';
import { activityService } from '../activityService';
import { notificationService } from '../notificationService';
import { settingsService, type EffectiveSettings } from '../settingsService';
import { scoreMatch, type ScoreResult, type ScoringRequirement } from './scoring';

const ALGORITHM_VERSION = 1;
const OPEN_STATUSES: MatchStatus[] = ['NEW', 'VIEWED', 'SHORTLISTED', 'CONTACTED'];
const UNIT_LABELS: Record<string, string> = { SQ_FT: 'Sq. Ft', SQ_YARD: 'Sq. Yard', SQ_METER: 'Sq. M', MARLA: 'Marla', KANAL: 'Kanal' };
const PROPERTY_LABELS: Record<PropertyType, string> = {
  RESIDENTIAL_PLOT: 'Plot',
  HOUSE: 'House',
  FLAT: 'Flat',
  APARTMENT: 'Apartment',
  PORTION: 'Portion',
  SHOP: 'Shop',
  OFFICE: 'Office',
  COMMERCIAL: 'Commercial',
  OTHER: 'Property',
};

interface Candidate {
  client: ClientDoc;
  requirement: RequirementDoc;
  property: PropertyDoc;
  result: ScoreResult;
}

function toScoringRequirement(r: RequirementDoc): ScoringRequirement {
  return {
    purpose: r.purpose,
    propertyTypes: r.propertyTypes ?? [],
    areas: r.areas ?? [],
    societies: r.societies ?? [],
    blocks: r.blocks ?? [],
    minSizeSqft: r.minSizeSqft ?? undefined,
    maxSizeSqft: r.maxSizeSqft ?? undefined,
    minBudget: r.minBudget ?? undefined,
    maxBudget: r.maxBudget ?? undefined,
  };
}

const listingFor = (purpose: RequirementDoc['purpose']) => (purpose === 'PURCHASE' ? 'SALE' : 'RENT');
const clientPurposeFor = (listing: PropertyDoc['listingPurpose']) => (listing === 'SALE' ? 'PURCHASE' : 'RENTAL');

async function recount(ctx: TenantContext, clientIds: Types.ObjectId[], propertyIds: Types.ObjectId[]) {
  const open = { $in: OPEN_STATUSES };
  for (const id of clientIds) {
    const n = await Match.countDocuments({ businessId: ctx.businessId, clientId: id, status: open });
    await Client.updateOne({ businessId: ctx.businessId, _id: id }, { $set: { matchCount: n } });
  }
  for (const id of propertyIds) {
    const n = await Match.countDocuments({ businessId: ctx.businessId, propertyId: id, status: open });
    await Property.updateOne({ businessId: ctx.businessId, _id: id }, { $set: { matchCount: n } });
  }
}

/**
 * Writes the scored candidates for one side of the relationship (one property
 * or one client), removes matches in that scope that no longer qualify, and
 * notifies on new high-quality matches. Idempotent: re-running it changes
 * nothing if the data hasn't changed.
 */
async function persist(
  ctx: TenantContext,
  settings: EffectiveSettings,
  scope: { propertyId?: Types.ObjectId; clientId?: Types.ObjectId },
  candidates: Candidate[],
): Promise<MatchDoc[]> {
  const keep = candidates.filter((c) => c.result.matchScore >= settings.matching.storeThreshold);
  const created: MatchDoc[] = [];

  for (const c of keep) {
    const before = await Match.findOneAndUpdate(
      { businessId: ctx.businessId, requirementId: c.requirement._id, propertyId: c.property._id },
      {
        $set: {
          clientId: c.client._id,
          matchScore: c.result.matchScore,
          band: c.result.band,
          breakdown: c.result.breakdown,
          matchReasons: c.result.matchReasons,
          algorithmVersion: ALGORITHM_VERSION,
        },
        $setOnInsert: { status: 'NEW', notified: false },
      },
      { upsert: true, new: false },
    ).lean<MatchDoc>();
    if (!before) {
      const doc = await Match.findOne({ businessId: ctx.businessId, requirementId: c.requirement._id, propertyId: c.property._id }).lean<MatchDoc>();
      if (doc) created.push(doc);
    } else if (before.status === 'STALE') {
      await Match.updateOne({ businessId: ctx.businessId, _id: before._id }, { $set: { status: 'NEW' } });
    }
  }

  // Remove matches in this scope that no longer meet the threshold.
  const keptPairs = new Set(keep.map((c) => `${c.requirement._id}:${c.property._id}`));
  const existing = await Match.find({ businessId: ctx.businessId, ...scope }).select('requirementId propertyId clientId').lean<MatchDoc[]>();
  const toDelete = existing.filter((m) => !keptPairs.has(`${m.requirementId}:${m.propertyId}`));
  if (toDelete.length) await Match.deleteMany({ businessId: ctx.businessId, _id: { $in: toDelete.map((m) => m._id) } });

  const clientIds = new Map<string, Types.ObjectId>();
  const propertyIds = new Map<string, Types.ObjectId>();
  for (const m of [...keep.map((c) => ({ clientId: c.client._id, propertyId: c.property._id })), ...toDelete]) {
    clientIds.set(m.clientId.toString(), m.clientId);
    propertyIds.set(m.propertyId.toString(), m.propertyId);
  }
  if (scope.clientId) clientIds.set(scope.clientId.toString(), scope.clientId);
  if (scope.propertyId) propertyIds.set(scope.propertyId.toString(), scope.propertyId);
  await recount(ctx, [...clientIds.values()], [...propertyIds.values()]);

  await announce(ctx, settings, candidates, created);
  return created;
}

async function announce(ctx: TenantContext, settings: EffectiveSettings, candidates: Candidate[], created: MatchDoc[]) {
  if (!created.length) return;
  const byKey = new Map(candidates.map((c) => [`${c.requirement._id}:${c.property._id}`, c]));
  let everyone: string[] | undefined;

  for (const m of created) {
    const c = byKey.get(`${m.requirementId}:${m.propertyId}`);
    if (!c) continue;
    eventBus.publish({
      name: SOCKET_EVENTS.MATCH_CREATED,
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      entity: 'match',
      entityId: m._id.toString(),
      data: { clientId: m.clientId.toString(), propertyId: m.propertyId.toString(), matchScore: m.matchScore },
    });
    const summary = `${m.matchScore}% match: ${c.client.fullName} ↔ ${c.property.propertyId}`;
    await activityService.record(ctx, 'MATCH_CREATED', summary, [
      { entityType: 'client', entityId: c.client._id, label: c.client.fullName },
      { entityType: 'property', entityId: c.property._id, label: c.property.propertyId },
    ], { matchId: m._id.toString(), matchScore: m.matchScore });

    if (m.matchScore >= settings.matching.notifyThreshold) {
      const recipients = c.client.assignedTo ? [c.client.assignedTo.toString()] : (everyone ??= await memberRepository.activeUserIds(ctx));
      const p = c.property;
      await notificationService.notify(ctx, {
        userIds: recipients,
        category: 'MATCH',
        title: `New ${m.matchScore}% match`,
        body: `${p.size} ${UNIT_LABELS[p.sizeUnit]} ${PROPERTY_LABELS[p.propertyType]} in ${p.society ?? p.area ?? '-'} (${formatPkr(p.askingPrice)}) matches ${c.client.fullName}`,
        deepLink: `/matches/${m._id}`,
        data: { matchId: m._id.toString(), clientId: m.clientId.toString(), propertyId: m.propertyId.toString() },
      });
      await Match.updateOne({ businessId: ctx.businessId, _id: m._id }, { $set: { notified: true } });
    }
  }
}

export const matchingService = {
  async recalcForProperty(ctx: TenantContext, property: PropertyDoc): Promise<MatchDoc[]> {
    const settings = await settingsService.get(ctx);
    if (property.status !== 'AVAILABLE' || property.deletedAt) {
      await this.markPropertyStale(ctx, property._id);
      return [];
    }
    const purpose = clientPurposeFor(property.listingPurpose);
    const clients = await Client.find({
      businessId: ctx.businessId,
      deletedAt: null,
      status: 'ACTIVE',
      requirements: { $elemMatch: { active: true, purpose } },
    }).lean<ClientDoc[]>();

    const candidates: Candidate[] = [];
    for (const client of clients) {
      for (const requirement of client.requirements.filter((r) => r.active && r.purpose === purpose)) {
        const result = scoreMatch(toScoringRequirement(requirement), property, settings.matching.weights);
        if (result) candidates.push({ client, requirement, property, result });
      }
    }
    return persist(ctx, settings, { propertyId: property._id }, candidates);
  },

  async recalcForClient(ctx: TenantContext, client: ClientDoc): Promise<MatchDoc[]> {
    const settings = await settingsService.get(ctx);
    const active = client.status === 'ACTIVE' && !client.deletedAt ? client.requirements.filter((r) => r.active) : [];
    const candidates: Candidate[] = [];

    for (const requirement of active) {
      const priceFilter =
        requirement.maxBudget !== undefined && requirement.maxBudget !== null
          ? { $or: [{ askingPrice: { $lte: requirement.maxBudget * 1.25 } }, { negotiable: true, minimumPrice: { $lte: requirement.maxBudget } }] }
          : {};
      const properties = await Property.find({
        businessId: ctx.businessId,
        deletedAt: null,
        status: 'AVAILABLE',
        listingPurpose: listingFor(requirement.purpose),
        ...priceFilter,
      }).lean<PropertyDoc[]>();
      for (const property of properties) {
        const result = scoreMatch(toScoringRequirement(requirement), property, settings.matching.weights);
        if (result) candidates.push({ client, requirement, property, result });
      }
    }
    return persist(ctx, settings, { clientId: client._id }, candidates);
  },

  /** Wrappers used after a write: matching problems are logged, never surfaced as request failures. */
  async safeRecalcForProperty(ctx: TenantContext, property: PropertyDoc) {
    try {
      return await this.recalcForProperty(ctx, property);
    } catch (err) {
      logger.error({ err, propertyId: property._id }, 'Matching failed for property');
      return [];
    }
  },

  async safeRecalcForClient(ctx: TenantContext, client: ClientDoc) {
    try {
      return await this.recalcForClient(ctx, client);
    } catch (err) {
      logger.error({ err, clientId: client._id }, 'Matching failed for client');
      return [];
    }
  },

  async markPropertyStale(ctx: TenantContext, propertyId: Types.ObjectId) {
    const affected = await Match.find({ businessId: ctx.businessId, propertyId, status: { $ne: 'STALE' } }).select('clientId').lean();
    await Match.updateMany({ businessId: ctx.businessId, propertyId, status: { $ne: 'STALE' } }, { $set: { status: 'STALE' } });
    await recount(ctx, affected.map((m) => m.clientId), [propertyId]);
  },

  async removeForClient(ctx: TenantContext, clientId: Types.ObjectId) {
    const affected = await Match.find({ businessId: ctx.businessId, clientId }).select('propertyId').lean();
    await Match.deleteMany({ businessId: ctx.businessId, clientId });
    await recount(ctx, [clientId], affected.map((m) => m.propertyId));
  },

  async removeForProperty(ctx: TenantContext, propertyId: Types.ObjectId) {
    const affected = await Match.find({ businessId: ctx.businessId, propertyId }).select('clientId').lean();
    await Match.deleteMany({ businessId: ctx.businessId, propertyId });
    await recount(ctx, affected.map((m) => m.clientId), [propertyId]);
  },

  /** Full recompute (after settings changes or on demand). */
  async recalcAll(ctx: TenantContext): Promise<{ properties: number; matches: number }> {
    const properties = await Property.find({ businessId: ctx.businessId, deletedAt: null, status: 'AVAILABLE' }).lean<PropertyDoc[]>();
    for (const p of properties) await this.recalcForProperty(ctx, p);
    const matches = await Match.countDocuments({ businessId: ctx.businessId, status: { $in: OPEN_STATUSES } });
    return { properties: properties.length, matches };
  },

  async list(
    ctx: TenantContext,
    q: { clientId?: string; propertyId?: string; minScore?: number; band?: string; status?: MatchStatus; includeStale?: boolean; page: number; limit: number },
  ) {
    const filter: Record<string, unknown> = { businessId: ctx.businessId };
    if (q.clientId) filter.clientId = q.clientId;
    if (q.propertyId) filter.propertyId = q.propertyId;
    if (q.minScore !== undefined) filter.matchScore = { $gte: q.minScore };
    if (q.band) filter.band = q.band;
    if (q.status) filter.status = q.status;
    else if (!q.includeStale) filter.status = { $in: OPEN_STATUSES };
    const [items, total] = await Promise.all([
      Match.find(filter)
        .sort({ matchScore: -1, createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate(scopedPopulate('clientId', 'fullName mobileNumber whatsappNumber email categoryId status'))
        .populate(scopedPopulate('propertyId', 'propertyId propertyType listingPurpose status society area block size sizeUnit askingPrice coverThumbnailUrl coverImageUrl'))
        .lean(),
      Match.countDocuments(filter),
    ]);
    return { items, total };
  },

  async get(ctx: TenantContext, id: string) {
    const m = await Match.findOne({ businessId: ctx.businessId, _id: id })
      .populate(scopedPopulate('clientId', 'fullName mobileNumber whatsappNumber email status'))
      .populate(scopedPopulate('propertyId', ''))
      .lean();
    if (!m) throw notFound(ERROR_CODES.MATCH_NOT_FOUND, 'Match not found');
    return m;
  },

  async setStatus(ctx: TenantContext, id: string, status: MatchStatus) {
    const m = await Match.findOneAndUpdate({ businessId: ctx.businessId, _id: id }, { $set: { status } }, { new: true }).lean<MatchDoc>();
    if (!m) throw notFound(ERROR_CODES.MATCH_NOT_FOUND, 'Match not found');
    await recount(ctx, [m.clientId], [m.propertyId]);
    return m;
  },
};
