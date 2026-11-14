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
import { AppError, badRequest, forbidden, notFound } from '../utils/AppError';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { financeReportService } from './financeReportService';
import { systemAuth } from './leadIntakeService';
import { notificationService } from './notificationService';
import { PERMISSIONS } from '@recrm/shared';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
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

export const portalService = {
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
      business: { name: business.name, phone: business.website?.phone ?? business.phone ?? null, whatsapp: business.website?.whatsapp ?? business.phone ?? null, email: business.website?.email ?? business.email ?? null, address: business.address ?? null },
    };
    if (link.kind === 'CLIENT') {
      const [deals, plans, leases] = await Promise.all([
        Deal.find({ businessId: bid, deletedAt: null, clientId: party._id }).select('dealNo stage agreedPrice finalPrice expectedCloseDate closedAt payments propertyId').populate(popProp).sort({ createdAt: -1 }).limit(20).lean<DealDoc[]>(),
        InstallmentPlan.find({ businessId: bid, deletedAt: null, clientId: party._id, status: { $ne: 'CANCELLED' } }).populate(popProp).sort({ createdAt: -1 }).limit(20).lean<InstallmentPlanDoc[]>(),
        Lease.find({ businessId: bid, deletedAt: null, tenantId: party._id }).populate(popProp).sort({ createdAt: -1 }).limit(20).lean<LeaseDoc[]>(),
      ]);
      return {
        ...base,
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
    const [leases, deals] = await Promise.all([
      Lease.find({ businessId: bid, deletedAt: null, $or: [{ landlordId: party._id }, { propertyId: { $in: ids } }] }).populate(popProp).sort({ createdAt: -1 }).limit(20).lean<LeaseDoc[]>(),
      Deal.find({ businessId: bid, deletedAt: null, propertyId: { $in: ids }, stage: { $ne: 'CLOSED_LOST' } }).select('dealNo stage propertyId updatedAt').populate(popProp).sort({ updatedAt: -1 }).limit(20).lean<DealDoc[]>(),
    ]);
    return {
      ...base,
      properties: properties.map((p) => ({ _id: p._id, ref: p.propertyId, propertyType: p.propertyType, listingPurpose: p.listingPurpose, status: p.status, location: [p.block, p.society, p.city].filter(Boolean).join(', '), size: p.size, sizeUnit: p.sizeUnit, askingPrice: p.askingPrice, verification: p.verification?.status ?? 'NOT_SUBMITTED', onWebsite: !!p.publicListing?.published, views: p.publicListing?.views ?? 0, inquiries: p.publicListing?.inquiries ?? 0, coverThumbnailUrl: p.coverThumbnailUrl ?? null })),
      leases: leases.map((l) => {
        const s = summarizeLease(l.schedule);
        return { _id: l._id, leaseNo: l.leaseNo, status: l.status, startDate: l.startDate, endDate: l.endDate, monthlyRent: l.monthlyRent, property: propLabel(l.propertyId), collected: s.totalPaid, overdue: s.overdue, nextDue: s.nextDue };
      }),
      deals: deals.map((d) => ({ dealNo: d.dealNo, stage: d.stage, property: propLabel(d.propertyId) })),
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
    await financeReportService.receiptPdf(systemAuth(business), kind, id, paymentId, out);
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
