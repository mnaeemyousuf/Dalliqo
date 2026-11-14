import { Types } from 'mongoose';
import { ERROR_CODES, campaignMetrics, slugify, type CampaignChannel, type CampaignStatus } from '@recrm/shared';
import { Campaign, type CampaignDoc } from '../models/Campaign';
import { Client } from '../models/Client';
import { Deal } from '../models/Deal';
import { Inquiry } from '../models/Inquiry';
import { createTenantRepository } from '../repositories/tenantRepository';
import type { AuthContext, TenantContext } from '../types/context';
import { conflict } from '../utils/AppError';
import { auditService } from './auditService';

export const campaignRepository = createTenantRepository<CampaignDoc>(Campaign, ERROR_CODES.NOT_FOUND);

export interface CampaignInput {
  name: string;
  channel: CampaignChannel;
  status?: CampaignStatus;
  code?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  budget?: number;
  spend?: number;
  notes?: string | null;
}

async function uniqueCode(ctx: TenantContext, wanted: string, excludeId?: string): Promise<string> {
  const base = slugify(wanted).slice(0, 32) || 'campaign';
  for (let i = 0; i < 50; i++) {
    const code = i ? `${base}-${i + 1}` : base;
    const clash = await Campaign.exists({ businessId: ctx.businessId, code, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (!clash) return code;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Leads, wins and commission received per campaign (from the records, never stored totals). */
async function figures(ctx: TenantContext, ids: Types.ObjectId[]) {
  const bid = new Types.ObjectId(ctx.businessId);
  const leads = await Client.aggregate<{ _id: Types.ObjectId; leads: number; clientIds: Types.ObjectId[] }>([
    { $match: { businessId: bid, deletedAt: null, campaignId: { $in: ids } } },
    { $group: { _id: '$campaignId', leads: { $sum: 1 }, clientIds: { $push: '$_id' } } },
  ]);
  const clientToCampaign = new Map<string, string>();
  for (const l of leads) for (const c of l.clientIds) clientToCampaign.set(String(c), String(l._id));
  const deals = clientToCampaign.size
    ? await Deal.find({ businessId: bid, deletedAt: null, stage: 'CLOSED_WON', clientId: { $in: [...clientToCampaign.keys()].map((x) => new Types.ObjectId(x)) } }).select('clientId receivedTotal').lean()
    : [];
  const inquiries = await Inquiry.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { businessId: bid, campaignId: { $in: ids } } }, { $group: { _id: '$campaignId', n: { $sum: 1 } } }]);
  const out = new Map<string, { leads: number; won: number; revenue: number; inquiries: number }>();
  for (const id of ids) out.set(String(id), { leads: 0, won: 0, revenue: 0, inquiries: 0 });
  for (const l of leads) out.get(String(l._id))!.leads = l.leads;
  const wonClients = new Map<string, Set<string>>();
  for (const d of deals) {
    const cid = clientToCampaign.get(String(d.clientId))!;
    const f = out.get(cid)!;
    f.revenue += d.receivedTotal ?? 0;
    if (!wonClients.has(cid)) wonClients.set(cid, new Set());
    wonClients.get(cid)!.add(String(d.clientId));
  }
  for (const [cid, set] of wonClients) out.get(cid)!.won = set.size;
  for (const i of inquiries) out.get(String(i._id))!.inquiries = i.n;
  return out;
}

export const campaignService = {
  async list(ctx: TenantContext, q: { status?: CampaignStatus; page: number; limit: number }) {
    const { items, total } = await campaignRepository.list(ctx, q.status ? { status: q.status } : {}, { page: q.page, limit: q.limit, sort: { createdAt: -1, _id: -1 } });
    const f = await figures(ctx, items.map((c) => c._id));
    return { items: items.map((c) => ({ ...c, metrics: { ...campaignMetrics({ spend: c.spend, ...f.get(String(c._id))! }), inquiries: f.get(String(c._id))!.inquiries } })), total };
  },

  async get(ctx: TenantContext, id: string) {
    const c = await campaignRepository.getById(ctx, id, 'Campaign not found');
    const f = (await figures(ctx, [c._id])).get(String(c._id))!;
    return { ...c, metrics: { ...campaignMetrics({ spend: c.spend, ...f }), inquiries: f.inquiries } };
  },

  async create(auth: AuthContext, input: CampaignInput) {
    const code = input.code ? slugify(input.code) : await uniqueCode(auth, input.name);
    if (input.code && (await Campaign.exists({ businessId: auth.businessId, code }))) throw conflict(ERROR_CODES.DUPLICATE_KEY, 'Another campaign already uses this code');
    const c = await campaignRepository.create(auth, { ...input, code, budget: input.budget ?? 0, spend: input.spend ?? 0 });
    await auditService.record(auth, { action: 'campaign.created', entityType: 'campaign', entityId: c._id, entityLabel: c.name });
    return campaignService.get(auth, String(c._id));
  },

  async update(auth: AuthContext, id: string, input: Partial<CampaignInput>) {
    await campaignRepository.getById(auth, id, 'Campaign not found');
    const set: Record<string, unknown> = { ...input };
    if (input.code !== undefined) {
      set.code = slugify(input.code);
      if (await Campaign.exists({ businessId: auth.businessId, code: set.code, _id: { $ne: id } })) throw conflict(ERROR_CODES.DUPLICATE_KEY, 'Another campaign already uses this code');
    }
    await campaignRepository.update(auth, id, set);
    await auditService.record(auth, { action: 'campaign.updated', entityType: 'campaign', entityId: new Types.ObjectId(id), meta: { fields: Object.keys(set) } });
    return campaignService.get(auth, id);
  },

  async remove(auth: AuthContext, id: string) {
    const c = await campaignRepository.softDelete(auth, id);
    await auditService.record(auth, { action: 'campaign.deleted', entityType: 'campaign', entityId: new Types.ObjectId(id), entityLabel: c.name });
  },

  /** All campaigns with ROI plus a "no campaign" baseline, for the Reports page. */
  async report(ctx: TenantContext) {
    const all = await Campaign.find({ businessId: ctx.businessId, deletedAt: null }).sort({ createdAt: -1 }).limit(200).lean<CampaignDoc[]>();
    const f = await figures(ctx, all.map((c) => c._id));
    const rows = all.map((c) => ({ _id: c._id, name: c.name, channel: c.channel, status: c.status, code: c.code, ...campaignMetrics({ spend: c.spend, ...f.get(String(c._id))! }), inquiries: f.get(String(c._id))!.inquiries }));
    const totals = campaignMetrics(rows.reduce((t, r) => ({ spend: t.spend + r.spend, leads: t.leads + r.leads, won: t.won + r.won, revenue: t.revenue + r.revenue }), { spend: 0, leads: 0, won: 0, revenue: 0 }));
    const bySource = await Client.aggregate<{ _id: string | null; leads: number }>([
      { $match: { businessId: new Types.ObjectId(ctx.businessId), deletedAt: null } },
      { $group: { _id: '$source', leads: { $sum: 1 } } },
      { $sort: { leads: -1 } },
    ]);
    return { rows, totals, bySource: bySource.map((s) => ({ source: s._id ?? 'OTHER', leads: s.leads })) };
  },
};
