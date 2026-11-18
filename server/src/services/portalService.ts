import { createHash, randomBytes } from 'node:crypto';
import type { Writable } from 'node:stream';
import { Types } from 'mongoose';
import { ERROR_CODES, PORTAL_LINK_DAYS, summarizeLease, type PortalKind } from '@recrm/shared';
import { env } from '../config/env';
import { Business, type BusinessDoc } from '../models/Business';
import { BusinessMember } from '../models/BusinessMember';
import { Client } from '../models/Client';
import { Deal, type DealDoc } from '../models/Deal';
import { InstallmentPlan, type InstallmentPlanDoc } from '../models/InstallmentPlan';
import { Lease, type LeaseDoc } from '../models/Lease';
import { PortalLink, type PortalLinkDoc } from '../models/PortalLink';
import { Property, type PropertyDoc } from '../models/Property';
import { PropertyOwner } from '../models/PropertyOwner';
import type { AuthContext, TenantContext } from '../types/context';
import { normalizeCurrency, withCurrency } from '../utils/text';
import { AppError, badRequest, forbidden, notFound } from '../utils/AppError';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { financeReportService } from './financeReportService';
import { systemAuth } from './leadIntakeService';
import { notificationService } from './notificationService';
import { followUpService } from './followUpService';
import { mediaService } from './mediaService';
import { matchingService } from './matching/matchingService';
import { PUBLIC_FIELDS, toPublic } from './websiteService';
import { Agreement } from '../models/Agreement';
import { Document, type FileAssetDoc } from '../models/FileAsset';
import { Inquiry } from '../models/Inquiry';
import { Match } from '../models/Match';
import { Transaction } from '../models/Transaction';
import { DEFAULT_PORTAL_SETTINGS, type PortalSettings } from '../models/Business';
import { isSensitiveCategory } from '@recrm/shared';
import { PERMISSIONS } from '@recrm/shared';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

/** Records whose shared documents the portal holder may see: themselves, plus (owners) their properties / (clients) their deals. */
async function portalDocumentEntityIds(link: PortalLinkDoc, business: BusinessDoc, partyId: Types.ObjectId): Promise<Types.ObjectId[]> {
  if (link.kind === 'CLIENT') {
    const deals = await Deal.find({ businessId: business._id, clientId: partyId, deletedAt: null }).select('_id').lean();
    return [partyId, ...deals.map((d) => d._id)];
  }
  const props = await Property.find({ businessId: business._id, deletedAt: null, $or: [{ ownerId: partyId }, { coOwnerIds: partyId }] }).select('_id').lean();
  return [partyId, ...props.map((p) => p._id)];
}

async function notifyAgents(link: PortalLinkDoc, business: BusinessDoc, party: { _id: Types.ObjectId; fullName: string }, title: string, body: string, extra?: string) {
  const ctx = systemAuth(business);
  const ids = [...new Set([extra, String(link.createdBy)].filter((x): x is string => !!x))];
  const active = await BusinessMember.find({ businessId: business._id, userId: { $in: ids }, status: 'ACTIVE' }).select('userId').lean();
  await notificationService.notify(ctx, {
    userIds: active.length ? active.map((m) => String(m.userId)) : [String(business.ownerUserId)],
    category: 'MARKETING',
    title,
    body: body.slice(0, 200),
    deepLink: `/${link.kind === 'CLIENT' ? 'clients' : 'owners'}/${party._id}`,
  });
}
const DAY = 86_400_000;

export const portalUrl = (token: string) => `${env.APP_WEB_URL.replace(/\/$/, '')}/portal/${token}`;

interface Resolved {
  link: PortalLinkDoc;
  business: BusinessDoc;
  party: { _id: Types.ObjectId; fullName: string };
}

async function resolve(token: string): Promise<Resolved> {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) throw notFound(ERROR_CODES.NOT_FOUND, 'This link is not valid');
  const link = await PortalLink.findOne({ tokenHash: sha(token) }).setOptions({ skipTenantGuard: true } as never).lean<PortalLinkDoc>();
  if (!link) throw notFound(ERROR_CODES.NOT_FOUND, 'This link is not valid');
  if (link.revokedAt || link.expiresAt < new Date()) throw new AppError(410, ERROR_CODES.LINK_EXPIRED, 'This link has expired. Ask your agent for a new one.');
  const business = await Business.findOne({ _id: link.businessId, status: 'ACTIVE' }).lean<BusinessDoc>();
  if (!business) throw notFound(ERROR_CODES.NOT_FOUND, 'This link is not valid');
  const Model = link.kind === 'CLIENT' ? Client : PropertyOwner;
  const party = await (Model as typeof Client).findOne({ businessId: link.businessId, _id: link.partyId, deletedAt: null }).select('fullName').lean<{ _id: Types.ObjectId; fullName: string }>();
  if (!party) throw new AppError(410, ERROR_CODES.LINK_EXPIRED, 'This link is no longer active');
  await PortalLink.updateOne({ businessId: link.businessId, _id: link._id }, { $set: { lastUsedAt: new Date() }, $inc: { useCount: 1 } });
  return { link, business, party };
}

const propLabel = (p: unknown) => {
  const x = p as Partial<PropertyDoc> | null;
  return x && typeof x === 'object' ? { ref: x.propertyId, location: [x.block, x.society, x.city].filter(Boolean).join(', ') } : null;
};
const popProp = { path: 'propertyId', select: 'propertyId block society city', options: { skipTenantGuard: true } };

const portalSettings = (b: BusinessDoc): PortalSettings => ({ ...DEFAULT_PORTAL_SETTINGS, ...(b.portal ?? {}) });
const firstName = (s: string) => s.trim().split(/\s+/)[0] ?? '';

export const portalService = {
  // ── Agency controls ──
  async getSettings(ctx: TenantContext) {
    const b = await Business.findById(ctx.businessId).select('portal').lean<BusinessDoc>();
    return portalSettings(b ?? ({} as BusinessDoc));
  },
  async updateSettings(auth: AuthContext, input: Partial<PortalSettings>) {
    const set = Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === 'boolean').map(([k, v]) => [`portal.${k}`, v]));
    await Business.updateOne({ _id: auth.businessId }, { $set: set });
    await auditService.record(auth, { action: 'portal.settings_updated', entityType: 'business', entityId: new Types.ObjectId(auth.businessId), meta: input as Record<string, unknown> });
    return portalService.getSettings(auth);
  },

  // ── Client self-service ──
  async updatePreferences(token: string, input: { minBudget?: number | null; maxBudget?: number | null; societies?: string[]; bedroomsMin?: number | null; notes?: string | null }) {
    const { link, business, party } = await resolve(token);
    if (link.kind !== 'CLIENT' || !portalSettings(business).allowPreferenceUpdates) throw forbidden(ERROR_CODES.FORBIDDEN, 'Changing preferences is not enabled');
    const c = await Client.findOne({ businessId: business._id, _id: party._id }).lean();
    const i = c?.requirements?.findIndex((r) => r.active && r.isPrimary) ?? -1;
    const idx = i >= 0 ? i : (c?.requirements?.findIndex((r) => r.active) ?? -1);
    if (!c || idx < 0) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'There is no active requirement to update — please message your agent');
    if (input.minBudget && input.maxBudget && input.minBudget > input.maxBudget) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The minimum budget is above the maximum');
    const set: Record<string, unknown> = {};
    const before = c.requirements[idx];
    if (input.minBudget !== undefined) set[`requirements.${idx}.minBudget`] = input.minBudget ?? undefined;
    if (input.maxBudget !== undefined) set[`requirements.${idx}.maxBudget`] = input.maxBudget ?? undefined;
    if (input.societies) set[`requirements.${idx}.societies`] = input.societies.map((s) => s.trim()).filter(Boolean).slice(0, 10);
    if (input.bedroomsMin !== undefined) set[`requirements.${idx}.bedroomsMin`] = input.bedroomsMin ?? undefined;
    if (input.notes !== undefined) set[`requirements.${idx}.notes`] = input.notes ?? undefined;
    const ctx = systemAuth(business);
    await Client.updateOne({ businessId: business._id, _id: c._id }, { $set: { ...set, updatedBy: ctx.userId }, $inc: { version: 1 } });
    const summary = [input.minBudget !== undefined || input.maxBudget !== undefined ? `budget ${input.minBudget ?? '—'}–${input.maxBudget ?? '—'}` : '', input.societies ? `areas ${input.societies.join(', ')}` : '', input.bedroomsMin ? `${input.bedroomsMin}+ bedrooms` : ''].filter(Boolean).join('; ');
    await activityService.record(ctx, 'CLIENT_UPDATED', `${party.fullName} updated their preferences in the portal${summary ? `: ${summary}` : ''}`, [{ entityType: 'client', entityId: c._id, label: party.fullName }]);
    await auditService.record(ctx, { action: 'client.portal_preferences', entityType: 'client', entityId: c._id, entityLabel: party.fullName, changes: Object.keys(set).map((k) => ({ field: k, oldValue: (before as unknown as Record<string, unknown>)[k.split('.').pop()!], newValue: set[k] })) });
    await matchingService.safeRecalcForClient(ctx, (await Client.findOne({ businessId: business._id, _id: c._id }).lean())!);
    await notifyAgents(link, business, party, `${party.fullName} updated their preferences`, summary || 'Preferences changed in the portal');
    return portalService.view(token);
  },

  /** Favourite (shortlist) or dismiss a matched property. */
  async reactToMatch(token: string, matchId: string, reaction: 'FAVORITE' | 'UNFAVORITE' | 'NOT_INTERESTED') {
    const { link, business, party } = await resolve(token);
    if (link.kind !== 'CLIENT' || !portalSettings(business).showMatches) throw forbidden();
    if (!Types.ObjectId.isValid(matchId)) throw notFound(ERROR_CODES.NOT_FOUND, 'Match not found');
    const status = reaction === 'FAVORITE' ? 'SHORTLISTED' : reaction === 'NOT_INTERESTED' ? 'REJECTED' : 'VIEWED';
    const m = await Match.findOneAndUpdate({ businessId: business._id, _id: matchId, clientId: party._id }, { $set: { status } }, { new: true }).lean();
    if (!m) throw notFound(ERROR_CODES.NOT_FOUND, 'Match not found');
    await activityService.record(systemAuth(business), 'CLIENT_UPDATED', `${party.fullName} ${reaction === 'FAVORITE' ? 'saved' : reaction === 'NOT_INTERESTED' ? 'is not interested in' : 'unsaved'} a matched property in the portal`, [{ entityType: 'client', entityId: party._id, label: party.fullName }, { entityType: 'property', entityId: m.propertyId }]);
    return { status };
  },

  async requestVisit(token: string, input: { propertyId: string; preferredAt: Date; note?: string }) {
    const { link, business, party } = await resolve(token);
    if (link.kind !== 'CLIENT' || !portalSettings(business).allowVisitRequests) throw forbidden(ERROR_CODES.FORBIDDEN, 'Visit requests are not enabled');
    if (!Types.ObjectId.isValid(input.propertyId)) throw notFound(ERROR_CODES.NOT_FOUND, 'Property not found');
    // Only properties this client was matched with (no browsing the whole inventory through the portal).
    const matched = await Match.exists({ businessId: business._id, clientId: party._id, propertyId: input.propertyId });
    if (!matched) throw notFound(ERROR_CODES.NOT_FOUND, 'Property not found');
    const prop = await Property.findOne({ businessId: business._id, _id: input.propertyId, deletedAt: null }).select('propertyId agentIds').lean<PropertyDoc>();
    if (!prop) throw notFound(ERROR_CODES.NOT_FOUND, 'Property not found');
    if (new Date(input.preferredAt) < new Date(Date.now() - 60 * 60_000)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Choose a time in the future');
    const ctx = systemAuth(business);
    const client = await Client.findOne({ businessId: business._id, _id: party._id }).select('assignedTo').lean();
    const assignee = client?.assignedTo ? String(client.assignedTo) : prop.agentIds?.[0] ? String(prop.agentIds[0]) : undefined;
    const active = assignee ? await BusinessMember.exists({ businessId: business._id, userId: assignee, status: 'ACTIVE' }) : null;
    const fu = await followUpService.create(ctx, {
      clientId: String(party._id),
      propertyId: input.propertyId,
      type: 'PROPERTY_VISIT',
      dueAt: new Date(input.preferredAt),
      priority: 'HIGH',
      notes: `Visit requested in the portal${input.note ? `: ${input.note}` : ''} — please confirm the time with the client.`.slice(0, 1000),
      assignedTo: active ? assignee : undefined,
    });
    await notifyAgents(link, business, party, `Visit request: ${prop.propertyId}`, `${party.fullName} asked to visit on ${new Date(input.preferredAt).toISOString().slice(0, 16).replace('T', ' ')}`, active ? assignee : undefined);
    return { requested: true, followUpId: String(fu._id) };
  },

  // ── Owner self-service ──
  /** The owner confirms the listing is still available (refreshes "availability confirmed") or tells the agency it is not. */
  async ownerAvailability(token: string, propertyId: string, input: { available: boolean; askingPrice?: number | null; note?: string }) {
    const { link, business, party } = await resolve(token);
    if (link.kind !== 'OWNER' || !portalSettings(business).allowOwnerAvailabilityUpdates) throw forbidden(ERROR_CODES.FORBIDDEN, 'Updates are not enabled');
    if (!Types.ObjectId.isValid(propertyId)) throw notFound(ERROR_CODES.NOT_FOUND, 'Property not found');
    const p = await Property.findOne({ businessId: business._id, _id: propertyId, deletedAt: null, $or: [{ ownerId: party._id }, { coOwnerIds: party._id }] }).select('propertyId askingPrice agentIds').lean<PropertyDoc>();
    if (!p) throw notFound(ERROR_CODES.NOT_FOUND, 'Property not found');
    const ctx = systemAuth(business);
    if (input.available) await Property.updateOne({ businessId: business._id, _id: p._id }, { $set: { lastVerifiedAt: new Date() } });
    const priceNote = input.askingPrice && input.askingPrice !== p.askingPrice ? ` Owner asks to change the price to Rs ${input.askingPrice.toLocaleString('en-PK')} (now Rs ${p.askingPrice.toLocaleString('en-PK')}).` : '';
    const text = `${party.fullName} ${input.available ? 'confirmed' : 'says it is NO LONGER'} available in the portal.${priceNote}${input.note ? ` Note: ${input.note}` : ''}`;
    await activityService.record(ctx, 'PROPERTY_UPDATED', `${p.propertyId}: ${text}`, [{ entityType: 'property', entityId: p._id, label: p.propertyId }, { entityType: 'owner', entityId: party._id, label: party.fullName }]);
    await notifyAgents(link, business, party, `${p.propertyId}: ${input.available ? 'availability confirmed' : 'owner says not available'}`, text, p.agentIds?.[0] ? String(p.agentIds[0]) : undefined);
    return { ok: true };
  },

  /** Shared document download (signed, short-lived URL). */
  async document(token: string, docId: string) {
    const { link, business, party } = await resolve(token);
    if (!portalSettings(business).showDocuments || !Types.ObjectId.isValid(docId)) throw notFound(ERROR_CODES.NOT_FOUND, 'Document not found');
    const ids = await portalDocumentEntityIds(link, business, party._id);
    const d = await Document.findOne({ businessId: business._id, _id: docId, deletedAt: null, sharedWithPortal: true, entityId: { $in: ids } }).lean<FileAssetDoc>();
    if (!d || isSensitiveCategory(d.category)) throw notFound(ERROR_CODES.NOT_FOUND, 'Document not found');
    await auditService.record(systemAuth(business), { action: 'document.portal_download', entityType: 'document', entityId: d._id, entityLabel: d.fileName, meta: { portalKind: link.kind, partyId: String(party._id) } });
    return mediaService.downloadUrl(systemAuth(business), String(d._id), 300);
  },
  // ── Staff ──

  async createLink(auth: AuthContext, input: { kind: PortalKind; partyId: string; days?: number }) {
    const need = input.kind === 'CLIENT' ? PERMISSIONS.CLIENTS_UPDATE : PERMISSIONS.OWNERS_UPDATE;
    if (!auth.permissions.includes(need)) throw forbidden();
    const Model = input.kind === 'CLIENT' ? Client : PropertyOwner;
    const party = await (Model as typeof Client).findOne({ businessId: auth.businessId, _id: input.partyId, deletedAt: null }).select('fullName mobileNumber whatsappNumber').lean();
    if (!party) throw notFound(ERROR_CODES.NOT_FOUND, input.kind === 'CLIENT' ? 'Client not found' : 'Owner not found');
    const days = Math.min(Math.max(input.days ?? PORTAL_LINK_DAYS.default, 1), PORTAL_LINK_DAYS.max);
    const token = randomBytes(32).toString('base64url');
    const link = await PortalLink.create({ businessId: auth.businessId, kind: input.kind, partyId: party._id, tokenHash: sha(token), expiresAt: new Date(Date.now() + days * DAY), createdBy: auth.userId, updatedBy: auth.userId });
    await activityService.record(auth, 'PORTAL_LINK_CREATED', `Portal link created for ${party.fullName} (valid ${days} days)`, [{ entityType: input.kind === 'CLIENT' ? 'client' : 'owner', entityId: party._id, label: party.fullName }]);
    await auditService.record(auth, { action: 'portal_link.created', entityType: input.kind === 'CLIENT' ? 'client' : 'owner', entityId: party._id, entityLabel: party.fullName, meta: { days } });
    const phone = (party as { whatsappNumber?: string; mobileNumber?: string }).whatsappNumber ?? (party as { mobileNumber?: string }).mobileNumber ?? null;
    return { _id: link._id, url: portalUrl(token), expiresAt: link.expiresAt, phone };
  },

  async listLinks(ctx: TenantContext, kind: PortalKind, partyId: string) {
    return PortalLink.find({ businessId: ctx.businessId, kind, partyId }).select('-tokenHash').sort({ createdAt: -1 }).limit(20).lean();
  },

  async revoke(auth: AuthContext, id: string) {
    const r = await PortalLink.findOneAndUpdate({ businessId: auth.businessId, _id: id }, { $set: { revokedAt: new Date(), updatedBy: auth.userId } }, { new: true }).select('-tokenHash').lean();
    if (!r) throw notFound(ERROR_CODES.NOT_FOUND, 'Link not found');
    await auditService.record(auth, { action: 'portal_link.revoked', entityType: r.kind === 'CLIENT' ? 'client' : 'owner', entityId: r.partyId });
    return r;
  },

  // ── Public (token) ──

  async view(token: string) {
    const { link, business, party } = await resolve(token);
    const bid = business._id;
    const base = {
      kind: link.kind,
      expiresAt: link.expiresAt,
      party: { fullName: party.fullName },
      business: { name: business.name, phone: business.website?.phone ?? business.phone ?? null, whatsapp: business.website?.whatsapp ?? business.phone ?? null, email: business.website?.email ?? business.email ?? null, address: business.address ?? null, currency: normalizeCurrency(business.currency) },
    };
    const ps = portalSettings(business);
    const documents = ps.showDocuments
      ? (await Document.find({ businessId: bid, deletedAt: null, sharedWithPortal: true, entityId: { $in: await portalDocumentEntityIds(link, business, party._id) } }).select('fileName category mimeType createdAt').sort({ createdAt: -1 }).limit(50).lean()).filter((d) => !isSensitiveCategory(d.category)).map((d) => ({ _id: d._id, fileName: d.fileName, category: d.category, createdAt: d.createdAt }))
      : [];
    if (link.kind === 'CLIENT') {
      const client = await Client.findOne({ businessId: bid, _id: party._id }).select('requirements').lean();
      const req = client?.requirements?.find((r) => r.active && r.isPrimary) ?? client?.requirements?.find((r) => r.active);
      const matches = ps.showMatches
        ? await Match.find({ businessId: bid, clientId: party._id, status: { $nin: ['REJECTED', 'STALE'] } }).sort({ status: -1, matchScore: -1 }).limit(12).lean()
        : [];
      const props = matches.length ? await Property.find({ businessId: bid, _id: { $in: matches.map((m) => m.propertyId) }, deletedAt: null, status: { $in: ['AVAILABLE', 'RESERVED', 'UNDER_NEGOTIATION'] } }).select(PUBLIC_FIELDS).lean() : [];
      const extra = {
        settings: ps,
        documents,
        requirement: req ? { purpose: req.purpose, propertyTypes: req.propertyTypes, societies: req.societies, areas: req.areas, minBudget: req.minBudget ?? null, maxBudget: req.maxBudget ?? null, bedroomsMin: req.bedroomsMin ?? null, notes: req.notes ?? null } : null,
        matches: matches.flatMap((m) => {
          const p = props.find((x) => String(x._id) === String(m.propertyId));
          return p ? [{ matchId: String(m._id), score: m.matchScore, favorite: m.status === 'SHORTLISTED', property: toPublic(p as never) }] : [];
        }),
      };
      const [deals, plans, leases] = await Promise.all([
        Deal.find({ businessId: bid, deletedAt: null, clientId: party._id }).select('dealNo stage agreedPrice finalPrice expectedCloseDate closedAt payments propertyId').populate(popProp).sort({ createdAt: -1 }).limit(20).lean<DealDoc[]>(),
        InstallmentPlan.find({ businessId: bid, deletedAt: null, clientId: party._id, status: { $ne: 'CANCELLED' } }).populate(popProp).sort({ createdAt: -1 }).limit(20).lean<InstallmentPlanDoc[]>(),
        Lease.find({ businessId: bid, deletedAt: null, tenantId: party._id }).populate(popProp).sort({ createdAt: -1 }).limit(20).lean<LeaseDoc[]>(),
      ]);
      return {
        ...base,
        ...extra,
        deals: deals.map((d) => ({ _id: d._id, dealNo: d.dealNo, stage: d.stage, price: d.finalPrice ?? d.agreedPrice ?? null, expectedCloseDate: d.expectedCloseDate ?? null, closedAt: d.closedAt ?? null, property: propLabel(d.propertyId), payments: d.payments.map((p) => ({ _id: p._id, date: p.date, amount: p.amount, method: p.method })) })),
        installmentPlans: plans.map((p) => ({ _id: p._id, planNo: p.planNo, title: p.title, status: p.status, totalAmount: p.totalAmount, paidTotal: p.paidTotal, outstanding: p.outstanding, overdueAmount: p.overdueAmount, nextDueDate: p.nextDueDate, property: propLabel(p.propertyId), items: p.items.map((i) => ({ label: i.label, dueDate: i.dueDate, amount: i.amount, paid: i.paid, status: i.status })), payments: p.payments.map((x) => ({ _id: x._id, date: x.date, amount: x.amount, method: x.method })) })),
        leases: leases.map((l) => {
          const s = summarizeLease(l.schedule);
          return { _id: l._id, leaseNo: l.leaseNo, status: l.status, startDate: l.startDate, endDate: l.endDate, monthlyRent: l.monthlyRent, property: propLabel(l.propertyId), overdue: s.overdue, nextDue: s.nextDue, schedule: l.schedule.map((i) => ({ period: i.period, dueDate: i.dueDate, amount: i.amount + (i.lateFee ?? 0), paid: i.paid, status: i.status })), payments: l.payments.map((x) => ({ _id: x._id, date: x.date, amount: x.amount, method: x.method })) };
        }),
      };
    }
    const properties = await Property.find({ businessId: bid, deletedAt: null, $or: [{ ownerId: party._id }, { coOwnerIds: party._id }] })
      .select('propertyId propertyType listingPurpose status society block city size sizeUnit askingPrice verification.status publicListing coverThumbnailUrl updatedAt')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean<PropertyDoc[]>();
    const ids = properties.map((p) => p._id);
    const [leases, deals, inquiries, agreements, maintenance] = await Promise.all([
      Lease.find({ businessId: bid, deletedAt: null, $or: [{ landlordId: party._id }, { propertyId: { $in: ids } }] }).populate(popProp).sort({ createdAt: -1 }).limit(20).lean<LeaseDoc[]>(),
      Deal.find({ businessId: bid, deletedAt: null, propertyId: { $in: ids }, stage: { $ne: 'CLOSED_LOST' } }).select('dealNo stage propertyId updatedAt offers').populate(popProp).sort({ updatedAt: -1 }).limit(20).lean<DealDoc[]>(),
      ps.showOwnerInquiries ? Inquiry.find({ businessId: bid, propertyId: { $in: ids } }).select('name channel createdAt propertyId').sort({ createdAt: -1 }).limit(30).lean() : Promise.resolve([]),
      Agreement.find({ businessId: bid, deletedAt: null, ownerId: party._id, status: { $in: ['SENT', 'SIGNED'] } }).select('agreementNo kind title status updatedAt').sort({ updatedAt: -1 }).limit(20).lean(),
      Transaction.aggregate<{ _id: Types.ObjectId; total: number }>([{ $match: { businessId: bid, deletedAt: null, type: 'EXPENSE', leaseId: { $ne: null } } }, { $group: { _id: '$leaseId', total: { $sum: '$amount' } } }]),
    ]);
    const refOf = (pid: unknown) => properties.find((p) => String(p._id) === String(pid))?.propertyId ?? '';
    return {
      ...base,
      properties: properties.map((p) => ({ _id: p._id, ref: p.propertyId, propertyType: p.propertyType, listingPurpose: p.listingPurpose, status: p.status, location: [p.block, p.society, p.city].filter(Boolean).join(', '), size: p.size, sizeUnit: p.sizeUnit, askingPrice: p.askingPrice, verification: p.verification?.status ?? 'NOT_SUBMITTED', onWebsite: !!p.publicListing?.published, views: p.publicListing?.views ?? 0, inquiries: p.publicListing?.inquiries ?? 0, coverThumbnailUrl: p.coverThumbnailUrl ?? null })),
      leases: leases.map((l) => {
        const s = summarizeLease(l.schedule);
        return { _id: l._id, leaseNo: l.leaseNo, status: l.status, startDate: l.startDate, endDate: l.endDate, monthlyRent: l.monthlyRent, property: propLabel(l.propertyId), collected: s.totalPaid, overdue: s.overdue, nextDue: s.nextDue, maintenance: maintenance.find((m) => String(m._id) === String(l._id))?.total ?? 0 };
      }),
      deals: deals.map((d) => ({ dealNo: d.dealNo, stage: d.stage, property: propLabel(d.propertyId), offers: ps.showOwnerOffers ? (d.offers ?? []).map((o) => ({ party: o.party, amount: o.amount, status: o.status, at: o.at })) : [] })),
      inquiries: inquiries.map((i) => ({ name: firstName(i.name), channel: i.channel, at: i.createdAt, ref: refOf(i.propertyId) })),
      agreements: agreements.map((a) => ({ agreementNo: a.agreementNo, kind: a.kind, title: a.title, status: a.status, updatedAt: a.updatedAt })),
      settings: ps,
      documents,
    };
  },

  /** Receipt for a payment on one of the portal holder's own records. */
  async receipt(token: string, kind: 'lease' | 'installment' | 'deal', id: string, paymentId: string, out: Writable) {
    const { link, business, party } = await resolve(token);
    if (!Types.ObjectId.isValid(id)) throw notFound(ERROR_CODES.NOT_FOUND, 'Receipt not found');
    const own =
      link.kind === 'CLIENT' &&
      (kind === 'lease'
        ? await Lease.exists({ businessId: business._id, _id: id, tenantId: party._id })
        : kind === 'installment'
          ? await InstallmentPlan.exists({ businessId: business._id, _id: id, clientId: party._id })
          : await Deal.exists({ businessId: business._id, _id: id, clientId: party._id }));
    if (!own) throw notFound(ERROR_CODES.NOT_FOUND, 'Receipt not found');
    await withCurrency(business.currency, () => financeReportService.receiptPdf(systemAuth(business), kind, id, paymentId, out));
  },

  /** "Contact my agent" from the portal: notifies the people looking after this client / owner. */
  async request(token: string, message: string) {
    if (!message.trim()) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Write a message');
    const { link, business, party } = await resolve(token);
    const ctx = systemAuth(business);
    let assignee: string | null = null;
    if (link.kind === 'CLIENT') {
      const c = await Client.findOne({ businessId: business._id, _id: party._id }).select('assignedTo').lean();
      assignee = c?.assignedTo ? String(c.assignedTo) : null;
    }
    const ids = [...new Set([assignee, String(link.createdBy)].filter((x): x is string => !!x))];
    const active = await BusinessMember.find({ businessId: business._id, userId: { $in: ids }, status: 'ACTIVE' }).select('userId').lean();
    const recipients = active.length ? active.map((m) => String(m.userId)) : [String(business.ownerUserId)];
    const entityType = link.kind === 'CLIENT' ? 'client' : 'owner';
    await activityService.record(ctx, 'PORTAL_REQUEST', `${party.fullName} wrote from the portal: “${message.slice(0, 300)}”`, [{ entityType, entityId: party._id, label: party.fullName }]);
    await notificationService.notify(ctx, {
      userIds: recipients,
      category: 'MARKETING',
      title: `Message from ${party.fullName}`,
      body: message.slice(0, 200),
      deepLink: `/${link.kind === 'CLIENT' ? 'clients' : 'owners'}/${party._id}`,
      data: { [`${entityType}Id`]: String(party._id) },
    });
    return { sent: true };
  },
};
