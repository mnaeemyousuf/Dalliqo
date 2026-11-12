import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import {
  CLIENT_PURPOSES,
  CLIENT_SOURCES,
  ERROR_CODES,
  LEAD_AGING_BUCKETS,
  PROPERTY_TYPES,
  SOCKET_EVENTS,
  scoreLead,
  temperatureFor,
  type ClientPurpose,
  type LeadTemperature,
  type PropertyType,
} from '@recrm/shared';
import { Client, type ClientDoc } from '../models/Client';
import { FollowUp } from '../models/FollowUp';
import { clientRepository } from '../repositories/entityRepositories';
import { memberRepository } from '../repositories/memberRepository';
import type { AuthContext, TenantContext } from '../types/context';
import { badRequest } from '../utils/AppError';
import { normalizePhone } from '../utils/phone';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { branchFilter } from './branchScope';
import { notificationService } from './notificationService';
import { publishChange } from './publish';
import { settingsService } from './settingsService';

/** Lead management on top of clients: scoring, assignment, reports and Excel import. */

const MAX_IMPORT_ROWS = 2000;

/** Columns of the import template; headers are matched case-insensitively. */
export const IMPORT_COLUMNS = [
  { key: 'fullName', header: 'Name', required: true },
  { key: 'mobileNumber', header: 'Mobile', required: true },
  { key: 'whatsappNumber', header: 'WhatsApp' },
  { key: 'email', header: 'Email' },
  { key: 'source', header: 'Source' },
  { key: 'campaign', header: 'Campaign' },
  { key: 'purpose', header: 'Purpose (PURCHASE/RENTAL)' },
  { key: 'propertyType', header: 'Property type' },
  { key: 'society', header: 'Society' },
  { key: 'area', header: 'Area' },
  { key: 'block', header: 'Block / Phase' },
  { key: 'minBudget', header: 'Min budget (PKR)' },
  { key: 'maxBudget', header: 'Max budget (PKR)' },
  { key: 'notes', header: 'Notes' },
] as const;

export interface LeadReportQuery {
  from?: Date;
  to?: Date;
  assignedTo?: string;
}

export const leadService = {
  /**
   * Recomputes the score, explanation and temperature of a client from its requirements,
   * engagement and follow-up history. Called after anything that changes those inputs.
   */
  async rescore(ctx: TenantContext, clientOrId: ClientDoc | string): Promise<{ score: number; temperature: LeadTemperature } | null> {
    const client = typeof clientOrId === 'string' ? await Client.findOne({ _id: clientOrId, businessId: ctx.businessId }).lean<ClientDoc>() : clientOrId;
    if (!client || client.deletedAt) return null;
    const settings = await settingsService.get(ctx);
    const now = new Date();
    const counts = await FollowUp.aggregate<{ _id: string; n: number }>([
      { $match: { businessId: new Types.ObjectId(ctx.businessId), clientId: client._id, deletedAt: null } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const by = Object.fromEntries(counts.map((c) => [c._id, c.n]));
    const primary = client.requirements?.find((r) => r.isPrimary) ?? client.requirements?.[0];
    const result = scoreLead(
      {
        status: client.status,
        purpose: primary?.purpose ?? client.purchaseOrRental,
        minBudget: primary?.minBudget ?? client.minBudget,
        maxBudget: primary?.maxBudget ?? client.maxBudget,
        societies: primary?.societies,
        blocks: primary?.blocks,
        areas: primary?.areas,
        propertyTypes: primary?.propertyTypes ?? client.propertyTypeRequired,
        matchCount: client.matchCount,
        createdAt: client.createdAt,
        lastContactedAt: client.lastContactedAt,
        followUpsCompleted: by.COMPLETED ?? 0,
        followUpsPending: by.PENDING ?? 0,
        followUpsOverdue: by.OVERDUE ?? 0,
        buyingTimeline: client.buyingTimeline,
      },
      settings.leadScoring,
      now.getTime(),
    );
    const temperature = client.temperatureOverride ?? result.temperature;
    // A direct update: scoring is derived data and must not bump the sync version or conflict with edits.
    await Client.updateOne(
      { _id: client._id, businessId: ctx.businessId },
      { $set: { leadScore: result.score, leadScoreReasons: result.reasons, temperature, leadScoredAt: now } },
    );
    return { score: result.score, temperature };
  },

  /** Rescores without failing the caller (scoring is never worth losing a save over). */
  async safeRescore(ctx: TenantContext, clientOrId: ClientDoc | string) {
    try {
      await leadService.rescore(ctx, clientOrId);
    } catch {
      /* logged by the global handler in tests; scoring catches up on the next change */
    }
  },

  /** Records first contact (response time) the first time a lead is reached. */
  async markContacted(ctx: TenantContext, clientId: string | Types.ObjectId, at = new Date()) {
    const c = await Client.findOne({ _id: clientId, businessId: ctx.businessId }).select('createdAt firstContactedAt').lean<ClientDoc>();
    if (!c) return;
    const set: Record<string, unknown> = { lastContactedAt: at };
    if (!c.firstContactedAt) {
      set.firstContactedAt = at;
      set.responseMinutes = Math.max(0, Math.round((at.getTime() - new Date(c.createdAt).getTime()) / 60_000));
    }
    await Client.updateOne({ _id: c._id, businessId: ctx.businessId }, { $set: set });
  },

  /** Assigns (or unassigns with null) a lead, keeps the history and tells the new assignee. */
  async assign(auth: AuthContext, id: string, to: string | null, note?: string) {
    const before = await clientRepository.getById(auth, id, 'Client not found');
    const from = before.assignedTo?.toString() ?? null;
    if (from === to) return before;
    if (to && !(await memberRepository.isActiveMemberUser(auth, to))) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Assigned user is not an active member of this business');
    }
    const entry = { from: from ? new Types.ObjectId(from) : null, to: to ? new Types.ObjectId(to) : null, at: new Date(), by: new Types.ObjectId(auth.userId), note };
    const updated = await clientRepository.update(auth, id, to ? { assignedTo: to } : {}, { unset: to ? [] : ['assignedTo'], push: { assignmentHistory: entry } });
    await activityService.record(auth, 'LEAD_ASSIGNED', `Lead ${before.fullName} ${to ? 'assigned' : 'unassigned'}${note ? `: ${note}` : ''}`, [
      { entityType: 'client', entityId: before._id, label: before.fullName },
    ], { from, to });
    await auditService.record(auth, { action: 'client.assigned', entityType: 'client', entityId: before._id, entityLabel: before.fullName, changes: [{ field: 'assignedTo', oldValue: from, newValue: to }] });
    if (to && to !== auth.userId) {
      await notificationService.notify(auth, {
        userIds: [to],
        category: 'LEAD',
        title: 'New lead assigned to you',
        body: `${before.fullName} (${before.mobileNumber})${note ? ` — ${note}` : ''}`,
        deepLink: `/clients/${before._id}`,
        data: { clientId: before._id.toString() },
      });
    }
    publishChange(auth, SOCKET_EVENTS.CLIENT_UPDATED, 'client', updated);
    return updated;
  },

  /** Lead KPIs: by source (with conversion), temperature, aging, response time, lost reasons. */
  async report(ctx: TenantContext, q: LeadReportQuery) {
    const match: Record<string, unknown> = { businessId: new Types.ObjectId(ctx.businessId), deletedAt: null, ...branchFilter(ctx) };
    if (q.assignedTo) match.assignedTo = new Types.ObjectId(q.assignedTo);
    if (q.from || q.to) match.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const now = Date.now();
    const [bySource, byTemperature, lost, totals, open] = await Promise.all([
      Client.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $ifNull: ['$source', 'UNKNOWN'] },
            leads: { $sum: 1 },
            converted: { $sum: { $cond: [{ $eq: ['$status', 'CLOSED_WON'] }, 1, 0] } },
            lost: { $sum: { $cond: [{ $eq: ['$status', 'CLOSED_LOST'] }, 1, 0] } },
            avgScore: { $avg: '$leadScore' },
          },
        },
        { $sort: { leads: -1 } },
      ]),
      Client.aggregate([{ $match: { ...match, status: 'ACTIVE' } }, { $group: { _id: '$temperature', n: { $sum: 1 } } }]),
      Client.aggregate([{ $match: { ...match, status: 'CLOSED_LOST' } }, { $group: { _id: { $ifNull: ['$lostReason', 'OTHER'] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      Client.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            leads: { $sum: 1 },
            converted: { $sum: { $cond: [{ $eq: ['$status', 'CLOSED_WON'] }, 1, 0] } },
            unassigned: { $sum: { $cond: [{ $and: [{ $eq: [{ $ifNull: ['$assignedTo', null] }, null] }, { $eq: ['$status', 'ACTIVE'] }] }, 1, 0] } },
            neverContacted: { $sum: { $cond: [{ $and: [{ $eq: [{ $ifNull: ['$lastContactedAt', null] }, null] }, { $eq: ['$status', 'ACTIVE'] }] }, 1, 0] } },
            avgResponseMinutes: { $avg: '$responseMinutes' },
          },
        },
      ]),
      Client.find({ ...match, status: 'ACTIVE' }).select('createdAt').lean<{ createdAt: Date }[]>(),
    ]);
    const aging = LEAD_AGING_BUCKETS.map((b) => ({ key: b.key, count: 0 }));
    for (const c of open) {
      const days = (now - new Date(c.createdAt).getTime()) / 86_400_000;
      aging[LEAD_AGING_BUCKETS.findIndex((b) => days <= b.maxDays)].count++;
    }
    const t = totals[0] ?? { leads: 0, converted: 0, unassigned: 0, neverContacted: 0, avgResponseMinutes: null };
    return {
      totals: {
        leads: t.leads,
        converted: t.converted,
        conversionRate: t.leads ? Math.round((t.converted / t.leads) * 1000) / 10 : 0,
        unassigned: t.unassigned,
        neverContacted: t.neverContacted,
        avgResponseMinutes: t.avgResponseMinutes === null || t.avgResponseMinutes === undefined ? null : Math.round(t.avgResponseMinutes),
      },
      bySource: bySource.map((s) => ({
        source: s._id as string,
        leads: s.leads as number,
        converted: s.converted as number,
        lost: s.lost as number,
        conversionRate: s.leads ? Math.round((s.converted / s.leads) * 1000) / 10 : 0,
        avgScore: Math.round(s.avgScore ?? 0),
      })),
      byTemperature: Object.fromEntries(['HOT', 'WARM', 'COLD'].map((k) => [k, byTemperature.find((x) => x._id === k)?.n ?? 0])),
      aging,
      lostReasons: lost.map((l) => ({ reason: l._id as string, count: l.n as number })),
    };
  },

  /** Blank Excel template with the expected columns and an example row. */
  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');
    ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));
    ws.getRow(1).font = { bold: true };
    ws.addRow({ fullName: 'Ali Raza', mobileNumber: '03001234567', source: 'FACEBOOK', campaign: 'DHA Phase 8 ad', purpose: 'PURCHASE', propertyType: 'HOUSE', society: 'DHA Karachi', block: 'Phase 8', minBudget: 50_000_000, maxBudget: 70_000_000 });
    const notes = wb.addWorksheet('Allowed values');
    notes.addRow(['Source', CLIENT_SOURCES.join(', ')]);
    notes.addRow(['Purpose', CLIENT_PURPOSES.join(', ')]);
    notes.addRow(['Property type', PROPERTY_TYPES.join(', ')]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  },

  /**
   * Imports leads from an Excel sheet. Each row goes through the normal client create path
   * (validation, duplicate check, matching, scoring); duplicates and invalid rows are reported,
   * never silently merged.
   */
  async importExcel(auth: AuthContext, buffer: Buffer, opts: { assignedTo?: string; source?: string } = {}) {
    // Imported here to avoid a require cycle (clientService rescoring through leadService).
    const { clientService } = await import('./clientService');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as never);
    } catch {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The file is not a valid Excel (.xlsx) workbook');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The workbook has no sheets');
    const headers: Record<number, string> = {};
    ws.getRow(1).eachCell((cell, col) => {
      const h = String(cell.value ?? '').trim().toLowerCase();
      const def = IMPORT_COLUMNS.find((c) => c.header.toLowerCase() === h || c.key.toLowerCase() === h || c.header.toLowerCase().startsWith(h));
      if (def) headers[col] = def.key;
    });
    if (!Object.values(headers).includes('fullName') || !Object.values(headers).includes('mobileNumber')) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The sheet needs at least the "Name" and "Mobile" columns');
    }
    if (ws.rowCount - 1 > MAX_IMPORT_ROWS) throw badRequest(ERROR_CODES.VALIDATION_ERROR, `Import at most ${MAX_IMPORT_ROWS} rows at a time`);
    if (opts.assignedTo && !(await memberRepository.isActiveMemberUser(auth, opts.assignedTo))) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Assigned user is not an active member of this business');
    }

    const result = { created: 0, duplicates: [] as { row: number; name: string; existing: string }[], errors: [] as { row: number; message: string }[] };
    const text = (v: unknown) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text).trim();
      if (typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result).trim();
      return String(v).trim();
    };
    const num = (v: string) => {
      const n = Number(v.replace(/[,\s]/g, ''));
      return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
    };
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const v: Record<string, string> = {};
      row.eachCell((cell, col) => {
        if (headers[col]) v[headers[col]] = text(cell.value);
      });
      if (!v.fullName && !v.mobileNumber) continue;
      const mobile = v.mobileNumber ? normalizePhone(v.mobileNumber.replace(/^(\d{10})$/, '0$1')) : null;
      if (!v.fullName || v.fullName.length < 2) {
        result.errors.push({ row: r, message: 'Name is missing' });
        continue;
      }
      if (!mobile) {
        result.errors.push({ row: r, message: `Invalid mobile number "${v.mobileNumber ?? ''}"` });
        continue;
      }
      const source = (v.source || opts.source || '').toUpperCase().replace(/[\s.]+/g, '_');
      const purpose = (v.purpose || 'PURCHASE').toUpperCase() as ClientPurpose;
      const type = (v.propertyType || '').toUpperCase().replace(/[\s/]+/g, '_') as PropertyType;
      const whatsapp = v.whatsappNumber ? normalizePhone(v.whatsappNumber) : null;
      const duplicates = await clientService.findDuplicates(auth, [mobile, whatsapp ?? undefined]);
      if (duplicates.length) {
        result.duplicates.push({ row: r, name: v.fullName, existing: duplicates[0].fullName });
        continue;
      }
      try {
        await clientService.create(auth, {
          fullName: v.fullName.slice(0, 120),
          mobileNumber: mobile,
          whatsappNumber: whatsapp ?? undefined,
          email: v.email && /.+@.+\..+/.test(v.email) ? v.email.toLowerCase() : undefined,
          source: (CLIENT_SOURCES as readonly string[]).includes(source) ? source : undefined,
          campaign: v.campaign?.slice(0, 120) || undefined,
          assignedTo: opts.assignedTo,
          notes: v.notes?.slice(0, 2000) || undefined,
          allowDuplicate: true,
          requirements: [
            {
              isPrimary: true,
              purpose: (CLIENT_PURPOSES as readonly string[]).includes(purpose) ? purpose : 'PURCHASE',
              propertyTypes: (PROPERTY_TYPES as readonly string[]).includes(type) ? [type] : [],
              societies: v.society ? [v.society.slice(0, 120)] : [],
              areas: v.area ? [v.area.slice(0, 120)] : [],
              blocks: v.block ? [v.block.slice(0, 60)] : [],
              minBudget: v.minBudget ? num(v.minBudget) : undefined,
              maxBudget: v.maxBudget ? num(v.maxBudget) : undefined,
            },
          ],
        });
        result.created++;
      } catch (err) {
        result.errors.push({ row: r, message: (err as Error).message });
      }
    }
    await auditService.record(auth, { action: 'client.imported', entityType: 'client', entityLabel: `${result.created} leads imported`, changes: [{ field: 'imported', oldValue: null, newValue: { created: result.created, duplicates: result.duplicates.length, errors: result.errors.length } }] });
    return result;
  },

  temperatureFor,
};
