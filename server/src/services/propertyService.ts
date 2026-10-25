import {
  ERROR_CODES,
  LISTING_VERIFICATION_STALE_DAYS,
  PROPERTY_STATUS_TRANSITIONS,
  SOCKET_EVENTS,
  type ListingPurpose,
  type PropertyStatus,
  type PropertyType,
  type SizeUnit,
} from '@recrm/shared';
import { nextSequence } from '../models/Counter';
import { scopedPopulate } from '../models/plugins/tenant';
import type { PropertyDoc } from '../models/Property';
import { ownerRepository, propertyRepository } from '../repositories/entityRepositories';
import { memberRepository } from '../repositories/memberRepository';
import type { AuthContext, RequestMeta, TenantContext } from '../types/context';
import { badRequest, notFound } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { escapeRegex, formatPkr, searchBlob } from '../utils/text';
import { withTransaction } from '../utils/transaction';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { matchingService } from './matching/matchingService';
import { notificationService } from './notificationService';
import { ownerService } from './ownerService';
import { publishChange } from './publish';
import { settingsService } from './settingsService';

export interface PropertyInput {
  uuid?: string;
  propertyType: PropertyType;
  listingPurpose?: ListingPurpose;
  status?: PropertyStatus;
  title?: string;
  area?: string;
  society?: string;
  block?: string;
  street?: string;
  plotNumber?: string;
  city?: string;
  size: number;
  sizeUnit: SizeUnit;
  askingPrice: number;
  expectedFinalPrice?: number;
  minimumPrice?: number;
  negotiable?: boolean;
  ownerId?: string | null;
  description?: string;
  latitude?: number | null;
  longitude?: number | null;
  googleMapsUrl?: string;
  bedrooms?: number;
  bathrooms?: number;
  floors?: number;
}

export interface PropertyQuery {
  q?: string;
  propertyId?: string;
  propertyType?: PropertyType;
  status?: PropertyStatus;
  listingPurpose?: ListingPurpose;
  area?: string;
  society?: string;
  block?: string;
  minPrice?: number;
  maxPrice?: number;
  minSize?: number;
  maxSize?: number;
  sizeUnit?: SizeUnit;
  ownerId?: string;
  verification?: 'stale' | 'fresh';
  near?: { lat: number; lng: number; radiusKm: number };
  sort?: string;
  page: number;
  limit: number;
}

const EDITABLE = [
  'propertyType', 'listingPurpose', 'title', 'area', 'society', 'block', 'street', 'plotNumber', 'city', 'size', 'sizeUnit',
  'askingPrice', 'expectedFinalPrice', 'minimumPrice', 'negotiable', 'ownerId', 'description', 'latitude', 'longitude',
  'googleMapsUrl', 'bedrooms', 'bathrooms', 'floors',
] as const;

/** Changes to these fields can change which clients match. */
const MATCH_FIELDS = ['propertyType', 'listingPurpose', 'area', 'society', 'block', 'size', 'sizeUnit', 'askingPrice', 'minimumPrice', 'negotiable'];

const SORTS: Record<string, Record<string, 1 | -1>> = {
  '-updatedAt': { updatedAt: -1, _id: -1 },
  '-createdAt': { createdAt: -1, _id: -1 },
  askingPrice: { askingPrice: 1, _id: 1 },
  '-askingPrice': { askingPrice: -1, _id: -1 },
  sizeSqft: { sizeSqft: 1, _id: 1 },
  '-sizeSqft': { sizeSqft: -1, _id: -1 },
  '-matchCount': { matchCount: -1, _id: -1 },
  propertyId: { propertyId: 1 },
};

const STATUS_LABEL: Record<PropertyStatus, string> = {
  AVAILABLE: 'Available', RESERVED: 'Reserved', SOLD: 'Sold', RENTED: 'Rented', WITHDRAWN: 'Withdrawn', INACTIVE: 'Inactive',
};

export const formatPropertyId = (n: number) => `RE-${String(n).padStart(6, '0')}`;

function locationFields(lat?: number | null, lng?: number | null, url?: string) {
  if (lat === null || lng === null) return { set: {}, unset: ['latitude', 'longitude', 'location'] };
  if (lat === undefined || lng === undefined) return { set: url ? { googleMapsUrl: url } : {}, unset: [] as string[] };
  return {
    set: {
      latitude: lat,
      longitude: lng,
      location: { type: 'Point', coordinates: [lng, lat] },
      googleMapsUrl: url ?? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    },
    unset: [] as string[],
  };
}

const blob = (p: object) => {
  const v = p as Record<string, string | undefined>; // only string fields are read
  return searchBlob(v.propertyId, v.title, v.area, v.society, v.block, v.street, v.plotNumber, v.city);
};

async function assertOwner(ctx: TenantContext, ownerId?: string | null) {
  if (ownerId && !(await ownerRepository.findById(ctx, ownerId))) throw badRequest(ERROR_CODES.OWNER_NOT_FOUND, 'Owner not found');
}

function assertPrices(p: { askingPrice?: number; minimumPrice?: number; expectedFinalPrice?: number }) {
  if (p.minimumPrice !== undefined && p.askingPrice !== undefined && p.minimumPrice > p.askingPrice) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Minimum price cannot be higher than the asking price');
  }
}

async function notifyOthers(auth: AuthContext, title: string, body: string, property: PropertyDoc) {
  const others = (await memberRepository.activeUserIds(auth)).filter((u) => u !== auth.userId);
  await notificationService.notify(auth, { userIds: others, category: 'PROPERTY', title, body, deepLink: `/properties/${property._id}`, data: { propertyId: property._id.toString() } });
}

export const propertyService = {
  async create(auth: AuthContext, input: PropertyInput, meta: RequestMeta = {}): Promise<PropertyDoc> {
    if (input.uuid) {
      const existing = await propertyRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    assertPrices(input);
    await assertOwner(auth, input.ownerId);
    const settings = await settingsService.get(auth);
    const loc = locationFields(input.latitude, input.longitude, input.googleMapsUrl);
    const { latitude: _la, longitude: _lo, googleMapsUrl: _g, ownerId, ...rest } = input;

    const property = await withTransaction(async (session) => {
      const propertyId = formatPropertyId(await nextSequence(auth.businessId, 'property', session));
      const doc = { ...rest, ...(ownerId ? { ownerId } : {}), ...loc.set, propertyId, status: input.status ?? 'AVAILABLE', statusChangedAt: new Date(), lastVerifiedAt: new Date(), lastVerifiedBy: auth.userId };
      return propertyRepository.create(auth, { ...doc, sizeSqft: settingsService.toSqft(settings, input.size, input.sizeUnit), searchText: blob(doc) }, session);
    });

    await ownerService.refreshPropertyCount(auth, property.ownerId);
    await activityService.record(auth, 'PROPERTY_CREATED', `Property ${property.propertyId} created (${formatPkr(property.askingPrice)})`, [
      { entityType: 'property', entityId: property._id, label: property.propertyId },
      ...(property.ownerId ? [{ entityType: 'owner' as const, entityId: property.ownerId }] : []),
    ]);
    await auditService.record(auth, { action: 'property.created', entityType: 'property', entityId: property._id, entityLabel: property.propertyId, ip: meta.ip });
    publishChange(auth, SOCKET_EVENTS.PROPERTY_CREATED, 'property', property);
    await matchingService.safeRecalcForProperty(auth, property);
    return (await propertyRepository.findById(auth, property._id.toString())) ?? property;
  },

  async list(ctx: TenantContext, q: PropertyQuery) {
    const filter: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];
    if (q.q) {
      const idMatch = /^(re-?)?\d{1,6}$/i.test(q.q.trim());
      if (idMatch) {
        const n = parseInt(q.q.replace(/\D/g, ''), 10);
        and.push({ $or: [{ propertyId: formatPropertyId(n) }, { plotNumber: q.q.trim() }] });
      } else {
        for (const t of searchBlob(q.q).split(' ').filter(Boolean)) and.push({ searchText: new RegExp(`(^|\\s)${escapeRegex(t)}`) });
      }
    }
    if (q.propertyId) filter.propertyId = q.propertyId.toUpperCase();
    if (q.propertyType) filter.propertyType = q.propertyType;
    if (q.status) filter.status = q.status;
    if (q.listingPurpose) filter.listingPurpose = q.listingPurpose;
    if (q.area) filter.area = new RegExp(escapeRegex(q.area), 'i');
    if (q.society) filter.society = new RegExp(escapeRegex(q.society), 'i');
    if (q.block) filter.block = new RegExp(`^${escapeRegex(q.block)}$`, 'i');
    if (q.ownerId) filter.ownerId = q.ownerId;
    if (q.verification) {
      const cutoff = new Date(Date.now() - LISTING_VERIFICATION_STALE_DAYS * 86_400_000);
      if (q.verification === 'stale') {
        filter.status = 'AVAILABLE';
        and.push({ $or: [{ lastVerifiedAt: { $lt: cutoff } }, { lastVerifiedAt: null }] });
      } else {
        filter.lastVerifiedAt = { $gte: cutoff };
      }
    }
    if (q.minPrice !== undefined || q.maxPrice !== undefined) {
      filter.askingPrice = { ...(q.minPrice !== undefined ? { $gte: q.minPrice } : {}), ...(q.maxPrice !== undefined ? { $lte: q.maxPrice } : {}) };
    }
    if (q.minSize !== undefined || q.maxSize !== undefined) {
      const settings = await settingsService.get(ctx);
      const unit = q.sizeUnit ?? 'SQ_YARD';
      filter.sizeSqft = {
        ...(q.minSize !== undefined ? { $gte: settingsService.toSqft(settings, q.minSize, unit) } : {}),
        ...(q.maxSize !== undefined ? { $lte: settingsService.toSqft(settings, q.maxSize, unit) } : {}),
      };
    }
    if (q.near) {
      filter.location = { $geoWithin: { $centerSphere: [[q.near.lng, q.near.lat], q.near.radiusKm / 6378.1] } };
    }
    if (and.length) filter.$and = and;
    return propertyRepository.list(ctx, filter, {
      page: q.page,
      limit: q.limit,
      sort: SORTS[q.sort ?? '-updatedAt'] ?? SORTS['-updatedAt'],
      populate: [{ path: 'ownerId', select: 'fullName mobileNumber' }],
    });
  },

  async get(ctx: TenantContext, id: string) {
    const p = await propertyRepository.model
      .findOne(propertyRepository.scope(ctx, { _id: id }))
      .populate(scopedPopulate('ownerId', 'fullName mobileNumber whatsappNumber email'))
      .lean<PropertyDoc>();
    if (!p) throw notFound(ERROR_CODES.PROPERTY_NOT_FOUND, 'Property not found');
    return p;
  },

  async update(auth: AuthContext, id: string, input: Partial<PropertyInput>, opts: { baseVersion?: number; meta?: RequestMeta } = {}): Promise<PropertyDoc> {
    const before = await propertyRepository.getById(auth, id, 'Property not found');
    if (input.status && input.status !== before.status) {
      // Route status edits through the transition rules.
      await this.changeStatus(auth, id, input.status, undefined, { baseVersion: opts.baseVersion });
      opts = { ...opts, baseVersion: undefined };
    }
    await assertOwner(auth, input.ownerId);
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const k of EDITABLE) {
      if (input[k] === undefined || k === 'latitude' || k === 'longitude' || k === 'googleMapsUrl') continue;
      if (input[k] === null) unset.push(k);
      else set[k] = input[k];
    }
    const loc = locationFields(input.latitude, input.longitude, input.googleMapsUrl);
    Object.assign(set, loc.set);
    unset.push(...loc.unset);
    const merged = { ...before, ...set } as PropertyDoc;
    assertPrices(merged);
    if (set.size !== undefined || set.sizeUnit !== undefined) {
      set.sizeSqft = settingsService.toSqft(await settingsService.get(auth), merged.size, merged.sizeUnit);
    }
    set.searchText = blob(merged);

    const updated = await propertyRepository.update(auth, id, set, { baseVersion: opts.baseVersion, unset });
    const changes = diffFields(before as unknown as Record<string, unknown>, { ...set, ...Object.fromEntries(unset.map((u) => [u, null])) }, EDITABLE);
    const refs = [{ entityType: 'property' as const, entityId: updated._id, label: updated.propertyId }];

    if (changes.length) {
      await auditService.record(auth, { action: 'property.updated', entityType: 'property', entityId: updated._id, entityLabel: updated.propertyId, changes, ip: opts.meta?.ip });
      const price = changes.find((c) => c.field === 'askingPrice');
      if (price) {
        await activityService.record(auth, 'PRICE_CHANGED', `${updated.propertyId} asking price ${formatPkr(price.oldValue as number)} → ${formatPkr(price.newValue as number)}`, refs, { from: price.oldValue, to: price.newValue });
        await notifyOthers(auth, 'Price changed', `${updated.propertyId}: ${formatPkr(price.oldValue as number)} → ${formatPkr(price.newValue as number)}`, updated);
      }
      const others = changes.filter((c) => c.field !== 'askingPrice');
      if (others.length) {
        await activityService.record(auth, 'PROPERTY_UPDATED', `${updated.propertyId} updated (${others.map((c) => c.field).join(', ')})`, refs, { fields: others.map((c) => c.field) });
      }
    }
    if (String(before.ownerId ?? '') !== String(updated.ownerId ?? '')) {
      await ownerService.refreshPropertyCount(auth, before.ownerId);
      await ownerService.refreshPropertyCount(auth, updated.ownerId);
    }
    publishChange(auth, SOCKET_EVENTS.PROPERTY_UPDATED, 'property', updated);
    if (changes.some((c) => MATCH_FIELDS.includes(c.field))) await matchingService.safeRecalcForProperty(auth, updated);
    return (await propertyRepository.findById(auth, id)) ?? updated;
  },

  /** Status changes always leave an activity entry such as "RE-000125 Available → Reserved". */
  async changeStatus(auth: AuthContext, id: string, status: PropertyStatus, reason?: string, opts: { baseVersion?: number; meta?: RequestMeta } = {}) {
    const before = await propertyRepository.getById(auth, id, 'Property not found');
    if (before.status === status) return before;
    if (!PROPERTY_STATUS_TRANSITIONS[before.status].includes(status)) {
      throw badRequest(ERROR_CODES.INVALID_STATUS_TRANSITION, `Cannot change status from ${STATUS_LABEL[before.status]} to ${STATUS_LABEL[status]}`);
    }
    const updated = await propertyRepository.update(auth, id, { status, statusChangedAt: new Date() }, { baseVersion: opts.baseVersion });
    const summary = `${updated.propertyId} ${STATUS_LABEL[before.status]} → ${STATUS_LABEL[status]}${reason ? ` (${reason})` : ''}`;
    await activityService.record(auth, 'STATUS_CHANGED', summary, [{ entityType: 'property', entityId: updated._id, label: updated.propertyId }], { from: before.status, to: status, reason });
    await auditService.record(auth, {
      action: 'property.status_changed', entityType: 'property', entityId: updated._id, entityLabel: updated.propertyId,
      changes: [{ field: 'status', oldValue: before.status, newValue: status }], meta: reason ? { reason } : undefined, ip: opts.meta?.ip,
    });
    publishChange(auth, SOCKET_EVENTS.PROPERTY_STATUS_CHANGED, 'property', updated, { from: before.status, to: status });
    await notifyOthers(auth, 'Property status changed', summary, updated);
    if (status === 'AVAILABLE') await matchingService.safeRecalcForProperty(auth, updated);
    else await matchingService.markPropertyStale(auth, updated._id);
    return updated;
  },

  /** Records that availability and price were re-confirmed with the owner today. */
  async verify(auth: AuthContext, id: string, note?: string, meta: RequestMeta = {}) {
    const updated = await propertyRepository.update(auth, id, { lastVerifiedAt: new Date(), lastVerifiedBy: auth.userId });
    const summary = `${updated.propertyId} availability confirmed${note ? ` (${note})` : ''}`;
    await activityService.record(auth, 'PROPERTY_VERIFIED', summary, [{ entityType: 'property', entityId: updated._id, label: updated.propertyId }], note ? { note } : undefined);
    await auditService.record(auth, { action: 'property.verified', entityType: 'property', entityId: updated._id, entityLabel: updated.propertyId, meta: note ? { note } : undefined, ip: meta.ip });
    publishChange(auth, SOCKET_EVENTS.PROPERTY_UPDATED, 'property', updated);
    return updated;
  },

  async remove(auth: AuthContext, id: string, opts: { baseVersion?: number; meta?: RequestMeta } = {}) {
    const deleted = await propertyRepository.softDelete(auth, id, { baseVersion: opts.baseVersion });
    await matchingService.removeForProperty(auth, deleted._id);
    await ownerService.refreshPropertyCount(auth, deleted.ownerId);
    await activityService.record(auth, 'PROPERTY_DELETED', `Property ${deleted.propertyId} deleted`, [{ entityType: 'property', entityId: deleted._id, label: deleted.propertyId }]);
    await auditService.record(auth, { action: 'property.deleted', entityType: 'property', entityId: deleted._id, entityLabel: deleted.propertyId, ip: opts.meta?.ip });
    publishChange(auth, SOCKET_EVENTS.PROPERTY_DELETED, 'property', deleted);
    return deleted;
  },

  async setCover(ctx: TenantContext, id: string, url?: string, thumbnailUrl?: string) {
    await propertyRepository.model.updateOne(
      { businessId: ctx.businessId, _id: id },
      url ? { $set: { coverImageUrl: url, coverThumbnailUrl: thumbnailUrl ?? url } } : { $unset: { coverImageUrl: 1, coverThumbnailUrl: 1 } },
    );
  },
};
