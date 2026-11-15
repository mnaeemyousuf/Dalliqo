import { env } from '../config/env';
import { Types } from 'mongoose';
import { ERROR_CODES, RESERVED_SLUGS, SLUG_PATTERN, slugify, type InquiryStatus, type ListingPurpose, type PropertyType } from '@recrm/shared';
import { Business, type BusinessDoc, type WebsiteSettings } from '../models/Business';
import { Campaign } from '../models/Campaign';
import { PropertyMedia } from '../models/FileAsset';
import { Inquiry, type InquiryDoc } from '../models/Inquiry';
import { Property, type PropertyDoc } from '../models/Property';
import { User } from '../models/User';
import { BusinessMember } from '../models/BusinessMember';
import { propertyRepository } from '../repositories/entityRepositories';
import type { AuthContext, TenantContext } from '../types/context';
import { badRequest, conflict, notFound } from '../utils/AppError';
import { escapeRegex } from '../utils/text';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { intakeLead } from './leadIntakeService';

/** Statuses a published listing is visible in; anything else (sold, rented, withdrawn…) drops off the site. */
const LIVE_STATUSES = ['AVAILABLE', 'RESERVED', 'UNDER_NEGOTIATION'];

export const PUBLIC_FIELDS =
  'propertyId propertyType listingPurpose status title area society block phase sector city size sizeUnit askingPrice negotiable bedrooms bathrooms floors furnishing facing corner mainRoad parkFacing possessionStatus developmentStatus constructionStatus amenities description coverImageUrl coverThumbnailUrl latitude longitude agentIds verification.status publicListing createdAt';

type PublicProperty = Pick<PropertyDoc, '_id' | 'propertyId' | 'propertyType' | 'listingPurpose' | 'status' | 'title' | 'area' | 'society' | 'block' | 'phase' | 'sector' | 'city' | 'size' | 'sizeUnit' | 'askingPrice' | 'negotiable' | 'bedrooms' | 'bathrooms' | 'floors' | 'furnishing' | 'facing' | 'corner' | 'mainRoad' | 'parkFacing' | 'possessionStatus' | 'amenities' | 'description' | 'coverImageUrl' | 'coverThumbnailUrl' | 'latitude' | 'longitude' | 'agentIds' | 'verification' | 'publicListing'>;

/** What the public may see of a listing: no owner, plot / street / unit number, floor price or exact pin. */
export function toPublic(p: PublicProperty) {
  const round = (n?: number) => (typeof n === 'number' ? Math.round(n * 500) / 500 : undefined); // ≈ 200 m
  return {
    _id: String(p._id),
    ref: p.propertyId,
    headline: p.publicListing?.headline || p.title || null,
    propertyType: p.propertyType,
    listingPurpose: p.listingPurpose,
    status: p.status,
    location: { area: p.area, society: p.society, block: p.block, phase: p.phase, sector: p.sector, city: p.city },
    size: p.size,
    sizeUnit: p.sizeUnit,
    price: p.askingPrice,
    negotiable: p.negotiable,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    floors: p.floors,
    furnishing: p.furnishing,
    facing: p.facing,
    corner: p.corner,
    mainRoad: p.mainRoad,
    parkFacing: p.parkFacing,
    possessionStatus: p.possessionStatus,
    amenities: p.amenities ?? [],
    description: p.description ?? null,
    coverImageUrl: p.coverImageUrl ?? null,
    coverThumbnailUrl: p.coverThumbnailUrl ?? null,
    approxLocation: p.latitude != null && p.longitude != null ? { lat: round(p.latitude), lng: round(p.longitude) } : null,
    verified: p.verification?.status === 'APPROVED',
    publishedAt: p.publicListing?.publishedAt ?? null,
  };
}

function publicSite(b: BusinessDoc) {
  const w = b.website!;
  return {
    slug: w.slug,
    name: b.name,
    tagline: w.tagline ?? null,
    about: w.about ?? null,
    phone: w.phone ?? b.phone ?? null,
    whatsapp: w.whatsapp ?? w.phone ?? b.phone ?? null,
    email: w.email ?? b.email ?? null,
    address: b.address ?? null,
    city: b.city ?? null,
  };
}

async function siteBySlug(slug: string): Promise<BusinessDoc> {
  const b = await Business.findOne({ 'website.slug': slug.toLowerCase(), 'website.enabled': true, status: 'ACTIVE' }).lean<BusinessDoc>();
  if (!b) throw notFound(ERROR_CODES.NOT_FOUND, 'This website does not exist or is offline');
  return b;
}

const liveFilter = (b: BusinessDoc) => ({ businessId: b._id, deletedAt: null, 'publicListing.published': true, status: { $in: LIVE_STATUSES } });

export interface PublicListingQuery {
  q?: string;
  purpose?: ListingPurpose;
  propertyType?: PropertyType;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  page: number;
  limit: number;
}

export const websiteService = {
  // ── Settings (signed in) ──

  async getSettings(ctx: TenantContext) {
    const b = await Business.findById(ctx.businessId).select('name website').lean<BusinessDoc>();
    const w: Partial<WebsiteSettings> = b?.website ?? {};
    const [published, inquiries] = await Promise.all([
      Property.countDocuments({ businessId: ctx.businessId, deletedAt: null, 'publicListing.published': true }),
      Inquiry.countDocuments({ businessId: ctx.businessId, status: 'NEW' }),
    ]);
    return { enabled: !!w.enabled, slug: w.slug ?? null, suggestedSlug: slugify(b?.name ?? ''), tagline: w.tagline ?? null, about: w.about ?? null, phone: w.phone ?? null, whatsapp: w.whatsapp ?? null, email: w.email ?? null, showAgents: w.showAgents ?? true, publishedListings: published, newInquiries: inquiries, url: w.slug ? `${env.APP_WEB_URL.replace(/\/$/, '')}/w/${w.slug}` : null };
  },

  async updateSettings(auth: AuthContext, input: Partial<WebsiteSettings>) {
    const set: Record<string, unknown> = {};
    if (input.slug !== undefined) {
      const slug = input.slug ? input.slug.toLowerCase() : null;
      if (slug) {
        if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.includes(slug)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Use 3–60 lower-case letters, digits and dashes for the web address');
        const taken = await Business.exists({ 'website.slug': slug, _id: { $ne: new Types.ObjectId(auth.businessId) } });
        if (taken) throw conflict(ERROR_CODES.SLUG_TAKEN, 'That web address is already taken');
      }
      set['website.slug'] = slug;
    }
    for (const k of ['tagline', 'about', 'phone', 'whatsapp', 'email', 'showAgents', 'enabled'] as const) if (input[k] !== undefined) set[`website.${k}`] = input[k];
    const current = await Business.findById(auth.businessId).select('website').lean<BusinessDoc>();
    const enabled = input.enabled ?? current?.website?.enabled;
    const slug = input.slug !== undefined ? set['website.slug'] : current?.website?.slug;
    if (enabled && !slug) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Choose a web address before switching the website on');
    await Business.updateOne({ _id: auth.businessId }, { $set: { ...set, updatedBy: auth.userId } });
    await auditService.record(auth, { action: 'website.updated', entityType: 'business', entityId: new Types.ObjectId(auth.businessId), meta: { fields: Object.keys(set) } });
    return websiteService.getSettings(auth);
  },

  async publish(auth: AuthContext, propertyId: string, input: { published: boolean; headline?: string | null }) {
    const p = await propertyRepository.getById(auth, propertyId, 'Property not found');
    const set: Record<string, unknown> = { 'publicListing.published': input.published };
    if (input.headline !== undefined) set['publicListing.headline'] = input.headline || null;
    if (input.published && !p.publicListing?.published) set['publicListing.publishedAt'] = new Date();
    await Property.updateOne({ businessId: auth.businessId, _id: p._id }, { $set: set });
    if (input.published !== !!p.publicListing?.published) {
      await activityService.record(auth, 'LISTING_PUBLISHED', `${p.propertyId} ${input.published ? 'published on' : 'removed from'} the website`, [{ entityType: 'property', entityId: p._id, label: p.propertyId }]);
    }
    return propertyRepository.getById(auth, propertyId);
  },

  async listInquiries(ctx: TenantContext, q: { status?: InquiryStatus; propertyId?: string; campaignId?: string; page: number; limit: number }) {
    const filter: Record<string, unknown> = { businessId: ctx.businessId };
    if (q.status) filter.status = q.status;
    if (q.propertyId) filter.propertyId = q.propertyId;
    if (q.campaignId) filter.campaignId = q.campaignId;
    const [items, total] = await Promise.all([
      Inquiry.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate({ path: 'propertyId', select: 'propertyId society block', options: { skipTenantGuard: true } })
        .populate({ path: 'campaignId', select: 'name', options: { skipTenantGuard: true } })
        .populate({ path: 'assignedTo', select: 'fullName' })
        .lean<InquiryDoc[]>(),
      Inquiry.countDocuments(filter),
    ]);
    return { items, total };
  },

  async setInquiryStatus(ctx: TenantContext, id: string, status: InquiryStatus) {
    const r = await Inquiry.findOneAndUpdate({ businessId: ctx.businessId, _id: id }, { $set: { status, updatedBy: ctx.userId } }, { new: true }).lean();
    if (!r) throw notFound(ERROR_CODES.NOT_FOUND, 'Inquiry not found');
    return r;
  },

  // ── Public (no sign-in) ──

  async site(slug: string) {
    const b = await siteBySlug(slug);
    const [count, purposes] = await Promise.all([Property.countDocuments(liveFilter(b)), Property.distinct('listingPurpose', liveFilter(b))]);
    let agents: { _id: string; fullName: string }[] = [];
    if (b.website?.showAgents) {
      const ids = await Property.distinct('agentIds', liveFilter(b));
      agents = (await User.find({ _id: { $in: ids } }).select('fullName').limit(30).lean()).map((u) => ({ _id: String(u._id), fullName: u.fullName }));
    }
    return { ...publicSite(b), listingCount: count, purposes, agents };
  },

  /** Agent landing page: name, contact and how many live listings — only for agents with a live listing. */
  async agent(slug: string, agentId: string) {
    const b = await siteBySlug(slug);
    if (!b.website?.showAgents || !Types.ObjectId.isValid(agentId)) throw notFound(ERROR_CODES.NOT_FOUND, 'Agent not found');
    const aid = new Types.ObjectId(agentId);
    const [listings, member, user] = await Promise.all([
      Property.countDocuments({ ...liveFilter(b), agentIds: aid }),
      BusinessMember.exists({ businessId: b._id, userId: aid, status: 'ACTIVE' }),
      User.findById(aid).select('fullName mobileNumber').lean(),
    ]);
    if (!listings || !member || !user) throw notFound(ERROR_CODES.NOT_FOUND, 'Agent not found');
    const purposes = await Property.distinct('listingPurpose', { ...liveFilter(b), agentIds: aid });
    return { site: publicSite(b), agent: { _id: agentId, fullName: user.fullName, mobileNumber: user.mobileNumber ?? null, listingCount: listings, purposes } };
  },

  async listings(slug: string, q: PublicListingQuery & { agentId?: string }) {
    const b = await siteBySlug(slug);
    const filter: Record<string, unknown> = liveFilter(b);
    if (q.purpose) filter.listingPurpose = q.purpose;
    if (q.propertyType) filter.propertyType = q.propertyType;
    if (q.bedrooms) filter.bedrooms = { $gte: q.bedrooms };
    if (q.agentId && Types.ObjectId.isValid(q.agentId)) filter.agentIds = new Types.ObjectId(q.agentId);
    if (q.minPrice || q.maxPrice) filter.askingPrice = { ...(q.minPrice ? { $gte: q.minPrice } : {}), ...(q.maxPrice ? { $lte: q.maxPrice } : {}) };
    if (q.q) {
      const re = new RegExp(escapeRegex(q.q.trim()), 'i');
      filter.$or = [{ society: re }, { area: re }, { city: re }, { block: re }, { title: re }, { 'publicListing.headline': re }, { propertyId: re }];
    }
    const sort: Record<string, 1 | -1> = q.sort === 'price_asc' ? { askingPrice: 1, _id: 1 } : q.sort === 'price_desc' ? { askingPrice: -1, _id: 1 } : { 'publicListing.publishedAt': -1, _id: -1 };
    const [items, total] = await Promise.all([
      Property.find(filter).select(PUBLIC_FIELDS).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean<PublicProperty[]>(),
      Property.countDocuments(filter),
    ]);
    return { items: items.map(toPublic), total };
  },

  async listing(slug: string, id: string) {
    const b = await siteBySlug(slug);
    if (!Types.ObjectId.isValid(id)) throw notFound(ERROR_CODES.NOT_FOUND, 'Listing not found');
    const p = await Property.findOneAndUpdate({ ...liveFilter(b), _id: id }, { $inc: { 'publicListing.views': 1 } }, { new: true }).select(PUBLIC_FIELDS).lean<PublicProperty>();
    if (!p) throw notFound(ERROR_CODES.NOT_FOUND, 'This listing is no longer available');
    const media = await PropertyMedia.find({ businessId: b._id, entityId: p._id, deletedAt: null, isPrivate: false, kind: { $in: ['image', 'video'] } })
      .select('kind fileUrl thumbnailUrl width height')
      .sort({ sortOrder: 1 })
      .limit(30)
      .lean();
    let agents: { _id: string; fullName: string; mobileNumber?: string }[] = [];
    if (b.website?.showAgents && p.agentIds?.length) {
      agents = (await User.find({ _id: { $in: p.agentIds } }).select('fullName mobileNumber').lean()).map((u) => ({ _id: String(u._id), fullName: u.fullName, mobileNumber: u.mobileNumber }));
    }
    return {
      site: publicSite(b),
      listing: { ...toPublic(p), media: media.map((m) => ({ kind: m.kind, url: m.fileUrl, thumbnailUrl: m.thumbnailUrl ?? m.fileUrl, width: m.width, height: m.height })), agents },
    };
  },

  async inquire(slug: string, input: { name: string; phone: string; email?: string; message?: string; propertyId?: string; campaign?: string; website?: string }, ip?: string) {
    const b = await siteBySlug(slug);
    // Honeypot: the hidden "website" field is only ever filled in by bots. Pretend success.
    if (input.website) return { received: true };
    if (input.propertyId) {
      const live = Types.ObjectId.isValid(input.propertyId) && (await Property.exists({ ...liveFilter(b), _id: input.propertyId }));
      if (!live) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'This listing is no longer available');
    }
    const campaign = input.campaign ? await Campaign.findOne({ businessId: b._id, code: input.campaign.toLowerCase(), deletedAt: null }).select('name').lean() : null;
    await intakeLead(b, { channel: 'WEBSITE', name: input.name, phone: input.phone, email: input.email, message: input.message, propertyId: input.propertyId, campaignId: campaign ? String(campaign._id) : null, campaignName: campaign?.name ?? null, ip });
    return { received: true };
  },
};
