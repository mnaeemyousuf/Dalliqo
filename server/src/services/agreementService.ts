import type { Writable } from 'node:stream';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { Types, type ClientSession } from 'mongoose';
import {
  AGREEMENT_DISCLAIMER,
  AGREEMENT_LABELS,
  AGREEMENT_RENEWAL_DAYS,
  AGREEMENT_TRANSITIONS,
  BRAND,
  BUILT_IN_AGREEMENT_TEMPLATES,
  ERROR_CODES,
  SOCKET_EVENTS,
  agreementMoney,
  amountInWords,
  isAgreementLocked,
  renderAgreement,
  type AgreementKind,
  type AgreementLanguage,
  type AgreementStatus,
  type AgreementValues,
} from '@recrm/shared';
import { logger } from '../config/logger';
import { nextSequence } from '../models/Counter';
import { Agreement, type AgreementDoc } from '../models/Agreement';
import { AgreementTemplate, type AgreementTemplateDoc } from '../models/AgreementTemplate';
import { Business } from '../models/Business';
import { Document } from '../models/FileAsset';
import { FollowUp } from '../models/FollowUp';
import { clientRepository, ownerRepository, propertyRepository } from '../repositories/entityRepositories';
import { createTenantRepository, type Filter } from '../repositories/tenantRepository';
import type { AuthContext, RequestMeta, TenantContext } from '../types/context';
import { badRequest, conflict, notFound } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { escapeRegex, searchBlob } from '../utils/text';
import { activityService, type ActivityRef } from './activityService';
import { auditService } from './auditService';
import { dealRepository } from './dealService';
import { followUpService } from './followUpService';
import { pdfParagraph, pdfText, registerUrduFonts } from './pdf/pdfText';
import { publishChange } from './publish';

export const agreementRepository = createTenantRepository<AgreementDoc>(Agreement, ERROR_CODES.AGREEMENT_NOT_FOUND);
export const agreementTemplateRepository = createTenantRepository<AgreementTemplateDoc>(AgreementTemplate, ERROR_CODES.AGREEMENT_TEMPLATE_NOT_FOUND);

export const formatAgreementNo = (n: number) => `AG-${String(n).padStart(6, '0')}`;

export interface AgreementInput {
  uuid?: string;
  branchId?: string;
  templateId?: string | null;
  kind: AgreementKind;
  language?: AgreementLanguage;
  title?: string;
  dealId?: string | null;
  clientId: string;
  ownerId?: string | null;
  propertyId?: string | null;
  amount?: number | null;
  tokenAmount?: number | null;
  monthlyRent?: number | null;
  securityDeposit?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
  clientCnic?: string;
  ownerCnic?: string;
  witness1?: string;
  witness2?: string;
  notes?: string;
  status?: AgreementStatus;
}

export interface AgreementQuery {
  q?: string;
  status?: AgreementStatus;
  kind?: AgreementKind;
  clientId?: string;
  propertyId?: string;
  dealId?: string;
  /** Signed rent agreements ending within this many days. */
  expiringWithinDays?: number;
  branchId?: string;
  page: number;
  limit: number;
}

const EDITABLE = [
  'branchId', 'templateId', 'kind', 'language', 'title', 'dealId', 'clientId', 'ownerId', 'propertyId', 'amount', 'tokenAmount', 'monthlyRent',
  'securityDeposit', 'startDate', 'endDate', 'clientCnic', 'ownerCnic', 'witness1', 'witness2', 'notes',
] as const;
/** Changing these re-plans the renewal follow-ups. */
const RENEWAL_FIELDS = ['kind', 'endDate', 'clientId', 'propertyId'] as const;

const POPULATE = [
  { path: 'clientId', select: 'fullName mobileNumber' },
  { path: 'ownerId', select: 'fullName mobileNumber' },
  { path: 'propertyId', select: 'propertyId society block city propertyType' },
  { path: 'dealId', select: 'dealNo title' },
];

const refsOf = (a: AgreementDoc): ActivityRef[] => [
  { entityType: 'agreement', entityId: a._id, label: a.agreementNo },
  { entityType: 'client', entityId: a.clientId },
  ...(a.propertyId ? [{ entityType: 'property' as const, entityId: a.propertyId }] : []),
  ...(a.ownerId ? [{ entityType: 'owner' as const, entityId: a.ownerId }] : []),
  ...(a.dealId ? [{ entityType: 'deal' as const, entityId: a.dealId }] : []),
];

const fmtDate = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' }) : '');
const months = (a?: Date | null, b?: Date | null) => {
  if (!a || !b) return '';
  const s = new Date(a);
  const e = new Date(b);
  const m = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + (e.getUTCDate() >= s.getUTCDate() - 1 ? 0 : -1);
  return m > 0 ? String(m) : '';
};

async function assertLinks(ctx: TenantContext, input: Partial<AgreementInput>) {
  if (input.clientId && !(await clientRepository.findById(ctx, input.clientId))) throw badRequest(ERROR_CODES.CLIENT_NOT_FOUND, 'Client not found');
  if (input.ownerId && !(await ownerRepository.findById(ctx, input.ownerId))) throw badRequest(ERROR_CODES.OWNER_NOT_FOUND, 'Owner not found');
  if (input.propertyId && !(await propertyRepository.findById(ctx, input.propertyId))) throw badRequest(ERROR_CODES.PROPERTY_NOT_FOUND, 'Property not found');
  if (input.dealId && !(await dealRepository.findById(ctx, input.dealId))) throw badRequest(ERROR_CODES.DEAL_NOT_FOUND, 'Deal not found');
}

async function pickTemplate(ctx: TenantContext, kind: AgreementKind, language: AgreementLanguage, templateId?: string | null) {
  if (templateId) {
    const t = await agreementTemplateRepository.findById(ctx, templateId);
    if (!t) throw badRequest(ERROR_CODES.AGREEMENT_TEMPLATE_NOT_FOUND, 'Template not found');
    return t;
  }
  const t = await AgreementTemplate.findOne({ businessId: ctx.businessId, deletedAt: null, archivedAt: null, kind, language }).sort({ builtIn: -1, createdAt: 1 }).lean<AgreementTemplateDoc>();
  return t;
}

/** Placeholder values from the agreement and its linked records, in the agreement's language. */
async function valuesFor(ctx: TenantContext, a: AgreementDoc): Promise<AgreementValues> {
  const lang = a.language;
  const [business, client, owner, property] = await Promise.all([
    Business.findById(ctx.businessId).select('name city').lean(),
    clientRepository.findById(ctx, String(a.clientId)),
    a.ownerId ? ownerRepository.findById(ctx, String(a.ownerId)) : null,
    a.propertyId ? propertyRepository.findById(ctx, String(a.propertyId)) : null,
  ]);
  // Owner falls back to the property's owner.
  const propOwner = !owner && property?.ownerId ? await ownerRepository.findById(ctx, String(property.ownerId)) : null;
  const o = owner ?? propOwner;
  const address = property ? [property.plotNumber && (lang === 'ur' ? `پلاٹ ${property.plotNumber}` : `Plot ${property.plotNumber}`), property.street, property.block, property.society ?? property.area, property.city].filter(Boolean).join(', ') : '';
  const unit = property ? (AGREEMENT_LABELS.sizeUnit[lang] as Record<string, string>)[property.sizeUnit] ?? property.sizeUnit : '';
  const balance = a.amount != null && a.tokenAmount != null ? Math.max(0, a.amount - a.tokenAmount) : null;
  return {
    agreementNo: a.agreementNo,
    date: fmtDate(new Date()),
    businessName: business?.name,
    city: property?.city ?? business?.city,
    clientName: client?.fullName,
    clientMobile: client?.mobileNumber,
    clientAddress: (client as { address?: string } | null)?.address,
    clientCnic: a.clientCnic,
    ownerName: o?.fullName,
    ownerMobile: o?.mobileNumber,
    ownerAddress: o?.address,
    ownerCnic: a.ownerCnic,
    propertyId: property?.propertyId,
    propertyAddress: address,
    propertySize: property ? `${property.size} ${unit}` : '',
    propertyType: property ? (AGREEMENT_LABELS.propertyType[lang] as Record<string, string>)[property.propertyType] : lang === 'ur' ? 'جائیداد' : 'property',
    amount: agreementMoney(a.amount, lang),
    amountWords: a.amount != null ? amountInWords(a.amount) : '',
    tokenAmount: agreementMoney(a.tokenAmount, lang),
    balanceAmount: agreementMoney(balance, lang),
    monthlyRent: agreementMoney(a.monthlyRent, lang),
    securityDeposit: agreementMoney(a.securityDeposit, lang),
    startDate: fmtDate(a.startDate),
    endDate: fmtDate(a.endDate),
    durationMonths: months(a.startDate, a.endDate),
    witness1: a.witness1,
    witness2: a.witness2,
  };
}

function assertEditable(a: AgreementDoc) {
  if (isAgreementLocked(a.status)) throw conflict(ERROR_CODES.AGREEMENT_LOCKED, `This agreement is ${a.status.toLowerCase()} and can no longer be changed`);
}

const BRAND_LOGO = [join(__dirname, '../../assets/brand/dalliqo-logo-horizontal.png'), join(process.cwd(), 'assets/brand/dalliqo-logo-horizontal.png')].find((p) => existsSync(p));

export const agreementService = {
  // ── Templates ──

  /** Built-in templates for a business (registration, migration). Idempotent by key. */
  async seedTemplates(ctx: TenantContext, session?: ClientSession): Promise<number> {
    let created = 0;
    for (const t of BUILT_IN_AGREEMENT_TEMPLATES) {
      const res = await AgreementTemplate.updateOne(
        { businessId: ctx.businessId, key: t.key },
        { $setOnInsert: { businessId: ctx.businessId, key: t.key, name: t.name, kind: t.kind, language: t.language, body: t.body, builtIn: true, uuid: new Types.UUID().toString(), version: 1, deletedAt: null, archivedAt: null, createdBy: ctx.userId, updatedBy: ctx.userId } },
        { upsert: true, session },
      );
      created += res.upsertedCount;
    }
    return created;
  },

  templates(ctx: TenantContext, q: { kind?: AgreementKind; language?: AgreementLanguage; includeArchived?: boolean } = {}) {
    const filter: Filter = { businessId: ctx.businessId, deletedAt: null };
    if (!q.includeArchived) filter.archivedAt = null;
    if (q.kind) filter.kind = q.kind;
    if (q.language) filter.language = q.language;
    return AgreementTemplate.find(filter).sort({ kind: 1, language: 1, builtIn: -1, name: 1 }).lean<AgreementTemplateDoc[]>();
  },

  async createTemplate(auth: AuthContext, input: { uuid?: string; name: string; kind: AgreementKind; language: AgreementLanguage; body: string }) {
    if (input.uuid) {
      const existing = await agreementTemplateRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    const t = await agreementTemplateRepository.create(auth, { ...input, builtIn: false });
    await auditService.record(auth, { action: 'agreement_template.created', entityType: 'agreementTemplate', entityId: t._id, entityLabel: t.name });
    publishChange(auth, SOCKET_EVENTS.AGREEMENT_UPDATED, 'agreementTemplate', t);
    return t;
  },

  async updateTemplate(auth: AuthContext, id: string, input: { name?: string; body?: string; archived?: boolean }) {
    const before = await agreementTemplateRepository.getById(auth, id, 'Template not found');
    if (before.builtIn && (input.name !== undefined || input.body !== undefined)) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Built-in templates cannot be changed: make a copy and edit the copy');
    }
    const set: Filter = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.body !== undefined) set.body = input.body;
    if (input.archived !== undefined) set.archivedAt = input.archived ? new Date() : null;
    const t = await agreementTemplateRepository.update(auth, id, set);
    await auditService.record(auth, { action: 'agreement_template.updated', entityType: 'agreementTemplate', entityId: t._id, entityLabel: t.name, changes: diffFields(before as never, set, ['name', 'body', 'archivedAt']) });
    publishChange(auth, SOCKET_EVENTS.AGREEMENT_UPDATED, 'agreementTemplate', t);
    return t;
  },

  // ── Agreements ──

  async create(auth: AuthContext, input: AgreementInput, meta: RequestMeta = {}): Promise<AgreementDoc> {
    if (input.uuid) {
      const existing = await agreementRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    await assertLinks(auth, input);
    const language = input.language ?? 'en';
    const template = await pickTemplate(auth, input.kind, language, input.templateId);
    const client = await clientRepository.findById(auth, input.clientId);
    // An agreement belongs to its client's branch unless one is given (like follow-ups).
    const branchId = input.branchId ?? (client?.branchId ? String(client.branchId) : undefined);
    const { status: _ignored, ...fields } = input;
    const agreementNo = formatAgreementNo(await nextSequence(auth.businessId, 'agreement'));
    const a = await agreementRepository.create(auth, {
      ...fields,
      branchId,
      language,
      templateId: template?._id ?? null,
      agreementNo,
      status: 'DRAFT',
      statusHistory: [{ status: 'DRAFT', at: new Date(), by: auth.userId }],
      versions: [],
      renewalFollowUpIds: [],
      searchText: searchBlob(agreementNo, input.title, client?.fullName),
    });
    await auditService.record(auth, { action: 'agreement.created', entityType: 'agreement', entityId: a._id, entityLabel: a.agreementNo, ip: meta.ip });
    await activityService.record(auth, 'AGREEMENT_CREATED', `Agreement ${a.agreementNo} drafted (${a.kind.toLowerCase().replace('_', ' ')})`, refsOf(a));
    // First version straight away, so the draft can be read and printed.
    const rendered = template ? await this.render(auth, String(a._id), {}, { quiet: true }) : a;
    const planned = await this.planRenewals(auth, rendered);
    publishChange(auth, SOCKET_EVENTS.AGREEMENT_CREATED, 'agreement', planned);
    return planned;
  },

  list(auth: AuthContext, q: AgreementQuery) {
    const filter: Filter = {};
    const and: Filter[] = [];
    if (q.q) {
      const no = /^(ag-?)?\d{1,6}$/i.test(q.q.trim()) ? formatAgreementNo(parseInt(q.q.replace(/\D/g, ''), 10)) : null;
      if (no) filter.agreementNo = no;
      else for (const tok of searchBlob(q.q).split(' ').filter(Boolean)) and.push({ searchText: new RegExp(`(^|\\s)${escapeRegex(tok)}`) });
    }
    if (q.status) filter.status = q.status;
    if (q.kind) filter.kind = q.kind;
    if (q.clientId) filter.clientId = q.clientId;
    if (q.propertyId) filter.propertyId = q.propertyId;
    if (q.dealId) filter.dealId = q.dealId;
    if (q.branchId) filter.branchId = q.branchId;
    if (q.expiringWithinDays !== undefined) {
      filter.status = 'SIGNED';
      filter.endDate = { $gte: new Date(), $lte: new Date(Date.now() + q.expiringWithinDays * 86_400_000) };
    }
    if (and.length) filter.$and = and;
    return agreementRepository.list(auth, filter, { page: q.page, limit: q.limit, sort: q.expiringWithinDays !== undefined ? { endDate: 1 } : { updatedAt: -1, _id: -1 }, populate: POPULATE, select: '-versions.body' });
  },

  async get(auth: AuthContext, id: string) {
    await agreementRepository.getById(auth, id, 'Agreement not found');
    // Populated ids come from the already-scoped agreement.
    let q = Agreement.findOne({ businessId: auth.businessId, _id: id });
    for (const p of POPULATE) q = q.populate({ ...p, options: { skipTenantGuard: true } });
    return (await q.populate({ path: 'statusHistory.by', select: 'fullName' }).populate({ path: 'versions.createdBy', select: 'fullName' }).lean<AgreementDoc>())!;
  },

  async update(auth: AuthContext, id: string, input: Partial<AgreementInput>, opts: { baseVersion?: number; meta?: RequestMeta } = {}) {
    const before = await agreementRepository.getById(auth, id, 'Agreement not found');
    if (input.status && input.status !== before.status) {
      // Offline status changes arrive inside an update.
      const { status, ...rest } = input;
      if (Object.values(rest).some((v) => v !== undefined)) await this.update(auth, id, rest, opts);
      return this.changeStatus(auth, id, { status }, { meta: opts.meta });
    }
    assertEditable(before);
    const set: Filter = {};
    for (const k of EDITABLE) if (input[k] !== undefined) set[k] = input[k];
    if (!Object.keys(set).length) return before;
    await assertLinks(auth, input);
    const client = await clientRepository.findById(auth, String(set.clientId ?? before.clientId));
    set.searchText = searchBlob(before.agreementNo, (set.title as string | undefined) ?? before.title, client?.fullName);
    const a = await agreementRepository.update(auth, id, set, { baseVersion: opts.baseVersion });
    const changes = diffFields(before as never, set, EDITABLE);
    if (changes.length) {
      await auditService.record(auth, { action: 'agreement.updated', entityType: 'agreement', entityId: a._id, entityLabel: a.agreementNo, changes, ip: opts.meta?.ip });
      await activityService.record(auth, 'AGREEMENT_UPDATED', `Agreement ${a.agreementNo} updated`, refsOf(a), { fields: changes.map((c) => c.field) });
    }
    const replan = RENEWAL_FIELDS.some((k) => set[k] !== undefined && String(set[k]) !== String(before[k as keyof AgreementDoc] ?? ''));
    const out = replan ? await this.planRenewals(auth, a) : a;
    publishChange(auth, SOCKET_EVENTS.AGREEMENT_UPDATED, 'agreement', out);
    return out;
  },

  /** Fills the template with the current details and keeps the result as a new version. */
  async render(auth: AuthContext, id: string, input: { templateId?: string } = {}, opts: { quiet?: boolean } = {}) {
    const a = await agreementRepository.getById(auth, id, 'Agreement not found');
    assertEditable(a);
    const template = await pickTemplate(auth, a.kind, a.language, input.templateId ?? (a.templateId ? String(a.templateId) : undefined));
    if (!template) throw badRequest(ERROR_CODES.AGREEMENT_TEMPLATE_NOT_FOUND, 'No template for this kind and language');
    const body = renderAgreement(template.body, await valuesFor(auth, a));
    const version = { no: (a.versions.at(-1)?.no ?? 0) + 1, body, source: 'RENDER' as const, createdAt: new Date(), createdBy: new Types.ObjectId(auth.userId) };
    const updated = await agreementRepository.update(auth, id, { versions: [...a.versions, version], templateId: template._id });
    if (!opts.quiet) {
      await activityService.record(auth, 'AGREEMENT_RENDERED', `Agreement ${a.agreementNo}: version ${version.no} generated from "${template.name}"`, refsOf(updated));
      await auditService.record(auth, { action: 'agreement.rendered', entityType: 'agreement', entityId: a._id, entityLabel: a.agreementNo, meta: { version: version.no, templateId: String(template._id) } });
      publishChange(auth, SOCKET_EVENTS.AGREEMENT_UPDATED, 'agreement', updated);
    }
    return updated;
  },

  /** Text changed by hand (e.g. a clause the lawyer asked for) becomes a new version. */
  async addVersion(auth: AuthContext, id: string, body: string) {
    const a = await agreementRepository.getById(auth, id, 'Agreement not found');
    assertEditable(a);
    const version = { no: (a.versions.at(-1)?.no ?? 0) + 1, body, source: 'EDIT' as const, createdAt: new Date(), createdBy: new Types.ObjectId(auth.userId) };
    const updated = await agreementRepository.update(auth, id, { versions: [...a.versions, version] });
    await activityService.record(auth, 'AGREEMENT_UPDATED', `Agreement ${a.agreementNo}: version ${version.no} edited by hand`, refsOf(updated));
    await auditService.record(auth, { action: 'agreement.version_added', entityType: 'agreement', entityId: a._id, entityLabel: a.agreementNo, meta: { version: version.no } });
    publishChange(auth, SOCKET_EVENTS.AGREEMENT_UPDATED, 'agreement', updated);
    return updated;
  },

  async changeStatus(auth: AuthContext, id: string, input: { status: AgreementStatus; note?: string; signedDocumentId?: string }, opts: { meta?: RequestMeta } = {}) {
    const a = await agreementRepository.getById(auth, id, 'Agreement not found');
    const set: Filter = {};
    if (input.signedDocumentId) {
      const doc = await Document.findOne({ businessId: auth.businessId, _id: input.signedDocumentId, deletedAt: null, entityType: 'agreement', entityId: a._id }).lean();
      if (!doc) throw badRequest(ERROR_CODES.DOCUMENT_NOT_FOUND, 'Upload the signed copy to this agreement first');
      set.signedDocumentId = doc._id;
    }
    if (input.status !== a.status) {
      if (!AGREEMENT_TRANSITIONS[a.status].includes(input.status)) {
        throw badRequest(ERROR_CODES.INVALID_STATUS_TRANSITION, `An agreement cannot go from ${a.status.toLowerCase()} to ${input.status.toLowerCase()}`);
      }
      if (input.status === 'SIGNED' && !a.versions.length) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Generate the agreement text before marking it signed');
      set.status = input.status;
      set.statusHistory = [...a.statusHistory, { status: input.status, at: new Date(), by: new Types.ObjectId(auth.userId), ...(input.note ? { note: input.note } : {}) }];
      if (input.status === 'SIGNED') set.signedAt = new Date();
    } else if (!set.signedDocumentId) {
      return a;
    }
    const updated = await agreementRepository.update(auth, id, set);
    if (set.status) {
      await activityService.record(auth, 'AGREEMENT_STATUS_CHANGED', `Agreement ${a.agreementNo}: ${a.status.toLowerCase()} → ${input.status.toLowerCase()}`, refsOf(updated), { from: a.status, to: input.status });
    }
    await auditService.record(auth, { action: 'agreement.status_changed', entityType: 'agreement', entityId: a._id, entityLabel: a.agreementNo, changes: diffFields(a as never, set, ['status', 'signedDocumentId']), ip: opts.meta?.ip });
    const out = set.status ? await this.planRenewals(auth, updated) : updated;
    publishChange(auth, SOCKET_EVENTS.AGREEMENT_UPDATED, 'agreement', out);
    return out;
  },

  async remove(auth: AuthContext, id: string, opts: { baseVersion?: number; meta?: RequestMeta } = {}) {
    const before = await agreementRepository.getById(auth, id, 'Agreement not found');
    if (before.status === 'SIGNED') throw conflict(ERROR_CODES.AGREEMENT_LOCKED, 'A signed agreement cannot be deleted (cancel it instead)');
    await this.cancelRenewals(auth, before);
    const a = await agreementRepository.softDelete(auth, id, { baseVersion: opts.baseVersion });
    await auditService.record(auth, { action: 'agreement.deleted', entityType: 'agreement', entityId: a._id, entityLabel: a.agreementNo, ip: opts.meta?.ip });
    await activityService.record(auth, 'AGREEMENT_DELETED', `Agreement ${a.agreementNo} deleted`, refsOf(a));
    publishChange(auth, SOCKET_EVENTS.AGREEMENT_DELETED, 'agreement', a);
    return a;
  },

  async cancelRenewals(auth: AuthContext, a: AgreementDoc) {
    const pending = await FollowUp.find({ businessId: auth.businessId, _id: { $in: a.renewalFollowUpIds ?? [] }, deletedAt: null, status: { $in: ['PENDING', 'OVERDUE'] } }).select('_id').lean();
    for (const f of pending) await followUpService.cancel(auth, String(f._id), `Agreement ${a.agreementNo} changed`).catch((err) => logger.warn({ err }, 'Could not cancel renewal follow-up'));
  },

  /**
   * Rent agreement with an end date (and not cancelled / expired): follow-ups 30 and 7 days before the
   * end date to discuss renewal. Re-planned whenever the dates, client or status change.
   */
  async planRenewals(auth: AuthContext, a: AgreementDoc): Promise<AgreementDoc> {
    await this.cancelRenewals(auth, a);
    const ids: Types.ObjectId[] = [];
    if (a.kind === 'RENT' && a.endDate && !['CANCELLED', 'EXPIRED'].includes(a.status)) {
      for (const days of AGREEMENT_RENEWAL_DAYS) {
        // 10:00 in Karachi on the day.
        const due = new Date(new Date(a.endDate).getTime() - days * 86_400_000);
        due.setUTCHours(5, 0, 0, 0);
        if (due <= new Date()) continue;
        const f = await followUpService.create(auth, {
          clientId: String(a.clientId),
          propertyId: a.propertyId ? String(a.propertyId) : null,
          type: 'CALL',
          dueAt: due,
          priority: days <= 7 ? 'HIGH' : 'MEDIUM',
          notes: `Rent agreement ${a.agreementNo} ends on ${fmtDate(a.endDate)} (${days} days): discuss renewal.`,
        });
        ids.push(f._id);
      }
    }
    if (!ids.length && !(a.renewalFollowUpIds ?? []).length) return a;
    await Agreement.updateOne({ businessId: auth.businessId, _id: a._id }, { $set: { renewalFollowUpIds: ids } }, { timestamps: false });
    return { ...a, renewalFollowUpIds: ids } as AgreementDoc;
  },

  /** Dashboard tiles. */
  async stats(auth: AuthContext) {
    const [drafts, awaitingSignature, expiringSoon] = await Promise.all([
      agreementRepository.count(auth, { status: 'DRAFT' }),
      agreementRepository.count(auth, { status: 'SENT' }),
      agreementRepository.count(auth, { status: 'SIGNED', endDate: { $gte: new Date(), $lte: new Date(Date.now() + 30 * 86_400_000) } }),
    ]);
    return { drafts, awaitingSignature, expiringSoon };
  },

  /** Prints a version (default: the latest) with the lawyer-review note in every page footer. */
  async pdf(auth: AuthContext, id: string, out: Writable, versionNo?: number): Promise<{ fileName: string }> {
    const a = await agreementRepository.getById(auth, id, 'Agreement not found');
    const version = versionNo ? a.versions.find((v) => v.no === versionNo) : a.versions.at(-1);
    if (!version) throw notFound(ERROR_CODES.AGREEMENT_NOT_FOUND, versionNo ? `Version ${versionNo} not found` : 'Generate the agreement text first');
    const business = await Business.findById(auth.businessId).select('name phone address').lean();
    const fileName = `${a.agreementNo}-v${version.no}.pdf`;
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 54, left: 56, right: 56, bottom: 86 }, bufferPages: true, info: { Title: `${a.agreementNo} ${a.title ?? ''}`.trim(), Author: business?.name ?? BRAND.name, Creator: BRAND.name } });
      doc.on('error', reject);
      out.on('finish', () => resolve());
      out.on('error', reject);
      registerUrduFonts(doc);
      doc.pipe(out);
      const left = doc.page.margins.left;
      const width = doc.page.width - left - doc.page.margins.right;
      if (BRAND_LOGO) doc.image(BRAND_LOGO, left + width - 100, 40, { height: 20 });
      doc.fillColor(BRAND.color.light.ink).fontSize(13);
      pdfText(doc, business?.name ?? '', left, 42, { width: width - 110 }, true);
      doc.fontSize(8).fillColor(BRAND.color.light.muted);
      pdfText(doc, [business?.address, business?.phone].filter(Boolean).join(' · '), left, doc.y, { width: width - 110 });
      doc.moveTo(left, doc.y + 6).lineTo(left + width, doc.y + 6).strokeColor(BRAND.color.primary['600']).lineWidth(1).stroke();
      doc.y += 18;
      doc.fillColor(BRAND.color.light.ink);
      const [title, ...rest] = version.body.split('\n');
      pdfParagraph(doc, title, left, width, { bold: true, size: 15, align: 'center' });
      doc.y += 4;
      pdfParagraph(doc, rest.join('\n'), left, width, { size: a.language === 'ur' ? 11.5 : 10.5, lineGap: a.language === 'ur' ? 5 : 3 });

      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const bottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const fy = doc.page.height - bottom + 10;
        doc.moveTo(left, fy - 4).lineTo(left + width, fy - 4).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
        doc.fillColor(BRAND.color.light.muted);
        doc.y = fy;
        if (a.language === 'ur') pdfParagraph(doc, AGREEMENT_DISCLAIMER.ur, left, width, { size: 7.5, lineGap: 1, bottom: doc.page.height });
        doc.font('Helvetica').fontSize(7).text(AGREEMENT_DISCLAIMER.en, left, doc.y, { width, lineGap: 1 });
        doc.fontSize(7).text(`${a.agreementNo} · version ${version.no} · ${a.status.toLowerCase()} · page ${i + 1} of ${range.count}`, left, doc.y + 2, { width, align: 'right', lineBreak: false });
        doc.page.margins.bottom = bottom;
      }
      doc.end();
    });
    return { fileName };
  },
};

