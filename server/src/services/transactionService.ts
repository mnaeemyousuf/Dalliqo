import { Types, type ClientSession } from 'mongoose';
import {
  DEFAULT_TRANSACTION_CATEGORIES,
  ERROR_CODES,
  SOCKET_EVENTS,
  type PaymentMethod,
  type TransactionType,
} from '@recrm/shared';
import { logger } from '../config/logger';
import type { DealDoc, DealPayment } from '../models/Deal';
import { Transaction, type TransactionDoc } from '../models/Transaction';
import { TransactionCategory, type TransactionCategoryDoc } from '../models/TransactionCategory';
import { clientRepository, propertyRepository } from '../repositories/entityRepositories';
import { createTenantRepository, type Filter } from '../repositories/tenantRepository';
import type { AuthContext, RequestMeta, TenantContext } from '../types/context';
import { badRequest, conflict, notFound } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { escapeRegex, searchBlob } from '../utils/text';
import { activityService, type ActivityRef } from './activityService';
import { auditService } from './auditService';
import { dealHooks, dealRepository } from './dealService';
import { publishChange } from './publish';
import { settingsService } from './settingsService';

export const transactionRepository = createTenantRepository<TransactionDoc>(Transaction, ERROR_CODES.TRANSACTION_NOT_FOUND);
export const transactionCategoryRepository = createTenantRepository<TransactionCategoryDoc>(TransactionCategory, ERROR_CODES.TRANSACTION_CATEGORY_NOT_FOUND);

export interface TransactionInput {
  uuid?: string;
  branchId?: string;
  type: TransactionType;
  categoryId: string;
  amount: number;
  date: Date;
  method?: PaymentMethod;
  dealId?: string | null;
  propertyId?: string | null;
  clientId?: string | null;
  description?: string;
  reference?: string;
}

export interface TransactionQuery {
  q?: string;
  type?: TransactionType;
  categoryId?: string;
  method?: PaymentMethod;
  dealId?: string;
  from?: Date;
  to?: Date;
  branchId?: string;
  page: number;
  limit: number;
}

const EDITABLE = ['branchId', 'type', 'categoryId', 'amount', 'date', 'method', 'dealId', 'propertyId', 'clientId', 'description', 'reference'] as const;
const money = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;
const kind = (t: TransactionDoc) => (t.type === 'INCOME' ? 'Income' : 'Expense');
const refsOf = (t: TransactionDoc): ActivityRef[] => [
  { entityType: 'transaction', entityId: t._id, label: `${kind(t)} ${money(t.amount)}` },
  ...(t.dealId ? [{ entityType: 'deal' as const, entityId: t.dealId }] : []),
];
const commissionKey = (dealId: unknown, paymentId: string) => `deal:${String(dealId)}:payment:${paymentId}`;

async function assertCategory(ctx: TenantContext, categoryId: string, type: TransactionType) {
  const c = await TransactionCategory.findOne({ businessId: ctx.businessId, _id: categoryId, deletedAt: null, archivedAt: null }).lean();
  if (!c) throw badRequest(ERROR_CODES.TRANSACTION_CATEGORY_NOT_FOUND, 'Category not found');
  if (c.type !== type) throw badRequest(ERROR_CODES.VALIDATION_ERROR, `This category is for ${c.type.toLowerCase()}`);
  return c;
}

async function assertLinks(ctx: TenantContext, input: Partial<TransactionInput>) {
  if (input.dealId && !(await dealRepository.findById(ctx, input.dealId))) throw badRequest(ERROR_CODES.DEAL_NOT_FOUND, 'Deal not found');
  if (input.propertyId && !(await propertyRepository.findById(ctx, input.propertyId))) throw badRequest(ERROR_CODES.PROPERTY_NOT_FOUND, 'Property not found');
  if (input.clientId && !(await clientRepository.findById(ctx, input.clientId))) throw badRequest(ERROR_CODES.CLIENT_NOT_FOUND, 'Client not found');
}

export const transactionService = {
  // ── Categories ──

  /** Built-in categories for a business (registration, migration). Idempotent by key. */
  async seedCategories(ctx: TenantContext, session?: ClientSession): Promise<number> {
    let created = 0;
    for (const [i, c] of DEFAULT_TRANSACTION_CATEGORIES.entries()) {
      const res = await TransactionCategory.updateOne(
        { businessId: ctx.businessId, key: c.key },
        { $setOnInsert: { businessId: ctx.businessId, key: c.key, name: c.name, nameUr: c.nameUr, type: c.type, isSystem: true, sortOrder: i, uuid: new Types.UUID().toString(), version: 1, deletedAt: null, archivedAt: null, createdBy: ctx.userId, updatedBy: ctx.userId } },
        { upsert: true, session },
      );
      created += res.upsertedCount;
    }
    return created;
  },

  async categories(ctx: TenantContext, includeArchived = false) {
    const filter: Filter = { businessId: ctx.businessId, deletedAt: null };
    if (!includeArchived) filter.archivedAt = null;
    return TransactionCategory.find(filter).sort({ type: 1, sortOrder: 1, name: 1 }).lean<TransactionCategoryDoc[]>();
  },

  async createCategory(auth: AuthContext, input: { uuid?: string; name: string; nameUr?: string; type: TransactionType }) {
    if (input.uuid) {
      const existing = await transactionCategoryRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    const clash = await TransactionCategory.findOne({ businessId: auth.businessId, deletedAt: null, type: input.type, name: new RegExp(`^${escapeRegex(input.name.trim())}$`, 'i') }).lean();
    if (clash) throw conflict(ERROR_CODES.DUPLICATE_KEY, 'A category with this name already exists');
    const c = await transactionCategoryRepository.create(auth, { ...input, isSystem: false, sortOrder: 100 });
    await auditService.record(auth, { action: 'transaction_category.created', entityType: 'transactionCategory', entityId: c._id, entityLabel: c.name });
    publishChange(auth, SOCKET_EVENTS.TRANSACTION_UPDATED, 'transactionCategory', c);
    return c;
  },

  async updateCategory(auth: AuthContext, id: string, input: { name?: string; nameUr?: string; archived?: boolean }) {
    const before = await transactionCategoryRepository.getById(auth, id, 'Category not found');
    if (before.isSystem && input.name && input.name !== before.name) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Built-in categories cannot be renamed (add an Urdu name or archive instead)');
    const set: Filter = {};
    if (input.name) set.name = input.name;
    if (input.nameUr !== undefined) set.nameUr = input.nameUr;
    if (input.archived !== undefined) set.archivedAt = input.archived ? new Date() : null;
    const c = await transactionCategoryRepository.update(auth, id, set);
    await auditService.record(auth, { action: 'transaction_category.updated', entityType: 'transactionCategory', entityId: c._id, entityLabel: c.name, changes: diffFields(before as never, set, ['name', 'nameUr', 'archivedAt']) });
    publishChange(auth, SOCKET_EVENTS.TRANSACTION_UPDATED, 'transactionCategory', c);
    return c;
  },

  // ── Transactions ──

  async create(auth: AuthContext, input: TransactionInput, meta: RequestMeta = {}, extra: { source?: 'MANUAL' | 'COMMISSION'; sourceKey?: string } = {}): Promise<TransactionDoc> {
    if (input.uuid) {
      const existing = await transactionRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    const cat = await assertCategory(auth, input.categoryId, input.type);
    await assertLinks(auth, input);
    const t = await transactionRepository.create(auth, {
      ...input,
      method: input.method ?? 'CASH',
      source: extra.source ?? 'MANUAL',
      sourceKey: extra.sourceKey ?? null,
      searchText: searchBlob(cat.name, input.description, input.reference),
    });
    await auditService.record(auth, { action: 'transaction.created', entityType: 'transaction', entityId: t._id, entityLabel: `${t.type} ${t.amount}`, meta: { categoryId: input.categoryId, amount: t.amount, source: t.source }, ip: meta.ip });
    await activityService.record(auth, 'TRANSACTION_RECORDED', `${kind(t)} of ${money(t.amount)} recorded (${cat.name})`, refsOf(t), { amount: t.amount, source: t.source });
    publishChange(auth, SOCKET_EVENTS.TRANSACTION_CREATED, 'transaction', t);
    return t;
  },

  list(auth: AuthContext, q: TransactionQuery) {
    const filter: Filter = {};
    const and: Filter[] = [];
    if (q.q) for (const tok of searchBlob(q.q).split(' ').filter(Boolean)) and.push({ searchText: new RegExp(`(^|\\s)${escapeRegex(tok)}`) });
    if (q.type) filter.type = q.type;
    if (q.categoryId) filter.categoryId = q.categoryId;
    if (q.method) filter.method = q.method;
    if (q.dealId) filter.dealId = q.dealId;
    if (q.branchId) filter.branchId = q.branchId;
    if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    if (and.length) filter.$and = and;
    return transactionRepository.list(auth, filter, {
      page: q.page,
      limit: q.limit,
      sort: { date: -1, _id: -1 },
      populate: [
        { path: 'categoryId', select: 'name nameUr type key' },
        { path: 'dealId', select: 'dealNo title' },
        { path: 'propertyId', select: 'propertyId' },
        { path: 'clientId', select: 'fullName' },
      ],
    });
  },

  get(auth: AuthContext, id: string) {
    return transactionRepository.getById(auth, id, 'Transaction not found');
  },

  async update(auth: AuthContext, id: string, input: Partial<TransactionInput>, opts: { baseVersion?: number; meta?: RequestMeta } = {}) {
    const before = await transactionRepository.getById(auth, id, 'Transaction not found');
    if (before.source === 'COMMISSION') throw conflict(ERROR_CODES.TRANSACTION_MANAGED_BY_DEAL, 'This income comes from a commission payment: change it on the deal');
    const set: Filter = {};
    for (const k of EDITABLE) if (input[k] !== undefined) set[k] = input[k];
    const merged = { ...before, ...set } as TransactionDoc;
    const cat = await assertCategory(auth, String(merged.categoryId), merged.type);
    await assertLinks(auth, input);
    set.searchText = searchBlob(cat.name, merged.description, merged.reference);
    const t = await transactionRepository.update(auth, id, set, { baseVersion: opts.baseVersion });
    const changes = diffFields(before as never, set, EDITABLE);
    if (changes.length) await auditService.record(auth, { action: 'transaction.updated', entityType: 'transaction', entityId: t._id, entityLabel: `${t.type} ${t.amount}`, changes, ip: opts.meta?.ip });
    if (changes.length) await activityService.record(auth, 'TRANSACTION_UPDATED', `${kind(t)} entry updated (${money(t.amount)})`, refsOf(t), { fields: changes.map((c) => c.field) });
    publishChange(auth, SOCKET_EVENTS.TRANSACTION_UPDATED, 'transaction', t);
    return t;
  },

  async remove(auth: AuthContext, id: string, opts: { baseVersion?: number; meta?: RequestMeta; fromDeal?: boolean } = {}) {
    const before = await transactionRepository.getById(auth, id, 'Transaction not found');
    if (before.source === 'COMMISSION' && !opts.fromDeal) throw conflict(ERROR_CODES.TRANSACTION_MANAGED_BY_DEAL, 'This income comes from a commission payment: remove the payment on the deal');
    const t = await transactionRepository.softDelete(auth, id, { baseVersion: opts.baseVersion });
    // Frees the payment's key, so the same payment re-added later gets its income entry back.
    if (t.sourceKey) await Transaction.updateOne({ businessId: auth.businessId, _id: t._id }, { $set: { sourceKey: `${t.sourceKey}:removed:${t._id}` } }, { timestamps: false });
    await auditService.record(auth, { action: 'transaction.deleted', entityType: 'transaction', entityId: t._id, entityLabel: `${t.type} ${t.amount}`, ip: opts.meta?.ip });
    await activityService.record(auth, 'TRANSACTION_DELETED', `${kind(t)} of ${money(t.amount)} deleted`, refsOf(t));
    publishChange(auth, SOCKET_EVENTS.TRANSACTION_DELETED, 'transaction', t);
    return t;
  },

  /**
   * Commission received on a deal → income transaction (when the setting is on). Keyed by the
   * payment, so replays and retries never create a second entry; a removed payment removes it.
   */
  async syncCommission(auth: AuthContext, deal: DealDoc, added: DealPayment[], removed: DealPayment[]) {
    for (const p of removed) {
      const t = await Transaction.findOne({ businessId: auth.businessId, sourceKey: commissionKey(deal._id, p._id), deletedAt: null }).lean();
      if (t) await this.remove(auth, String(t._id), { fromDeal: true });
    }
    if (!added.length) return;
    const settings = await settingsService.get(auth);
    if (!settings.commission.autoCreateIncome) return;
    const cat = await TransactionCategory.findOne({ businessId: auth.businessId, key: 'COMMISSION', deletedAt: null }).lean();
    const categoryId = cat?._id ?? (await this.seedCategories(auth), (await TransactionCategory.findOne({ businessId: auth.businessId, key: 'COMMISSION' }).lean())!._id);
    for (const p of added) {
      const key = commissionKey(deal._id, p._id);
      const existing = await Transaction.findOne({ businessId: auth.businessId, sourceKey: key }).lean();
      if (existing && !existing.deletedAt) continue;
      try {
        // A deal member may record payments without finance permissions: the entry is created for them.
        const t = await this.create(
          { ...auth, branchIds: undefined, allowedBranchIds: undefined },
          {
            branchId: String(deal.branchId),
            type: 'INCOME',
            categoryId: String(categoryId),
            amount: p.amount,
            date: new Date(p.date),
            method: p.method,
            dealId: String(deal._id),
            clientId: String(deal.clientId),
            propertyId: deal.propertyId ? String(deal.propertyId) : null,
            description: `Commission ${deal.dealNo} (${p.side.toLowerCase()} side)`,
            reference: p.reference,
          },
          {},
          { source: 'COMMISSION', sourceKey: key },
        );
        await dealRepository.model.updateOne({ businessId: auth.businessId, _id: deal._id, 'payments._id': p._id }, { $set: { 'payments.$.transactionId': t._id } });
      } catch (err) {
        // A concurrent run won the unique key: fine. Anything else must not fail the payment itself.
        if ((err as { code?: number }).code !== 11000) logger.error({ err, dealId: deal._id }, 'Could not record commission income');
      }
    }
  },

  /** Income, expense and net per month or per category, for a date range. */
  async report(auth: AuthContext, q: { groupBy: 'month' | 'category'; from?: Date; to?: Date }) {
    const match: Filter = {};
    if (q.from || q.to) match.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const key = q.groupBy === 'month' ? { $dateToString: { format: '%Y-%m', date: '$date', timezone: 'Asia/Karachi' } } : '$categoryId';
    const rows = await transactionRepository.aggregate<{ _id: { key: unknown; type: TransactionType }; total: number; count: number }>(auth, match, [
      { $group: { _id: { key, type: '$type' }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const cats = q.groupBy === 'category' ? new Map((await this.categories(auth, true)).map((c) => [String(c._id), c])) : new Map();
    const byKey = new Map<string, { key: string; label: string; labelUr?: string; income: number; expense: number; count: number }>();
    for (const r of rows) {
      const k = String(r._id.key);
      const cat = cats.get(k) as TransactionCategoryDoc | undefined;
      const row = byKey.get(k) ?? { key: k, label: cat?.name ?? k, labelUr: cat?.nameUr, income: 0, expense: 0, count: 0 };
      if (r._id.type === 'INCOME') row.income += r.total;
      else row.expense += r.total;
      row.count += r.count;
      byKey.set(k, row);
    }
    const list = [...byKey.values()].map((r) => ({ ...r, net: r.income - r.expense }));
    list.sort((a, b) => (q.groupBy === 'month' ? a.key.localeCompare(b.key) : b.income + b.expense - (a.income + a.expense)));
    const totals = list.reduce((t, r) => ({ income: t.income + r.income, expense: t.expense + r.expense }), { income: 0, expense: 0 });
    return { groupBy: q.groupBy, rows: list, totals: { ...totals, net: totals.income - totals.expense } };
  },

  /** Dashboard tiles: this month's income, expense and net. */
  async stats(auth: AuthContext) {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const r = await this.report(auth, { groupBy: 'month', from: start });
    return { incomeThisMonth: r.totals.income, expenseThisMonth: r.totals.expense, netThisMonth: r.totals.net };
  },
};

// Commission payments recorded on deals create / remove their income entries.
dealHooks.onPaymentsChanged = (auth, deal, added, removed) => transactionService.syncCommission(auth, deal, added, removed);

/** Not found in this business (used by documents for receipts). */
export async function assertTransaction(ctx: TenantContext, id: string) {
  const t = await transactionRepository.findById(ctx, id);
  if (!t) throw notFound(ERROR_CODES.TRANSACTION_NOT_FOUND, 'Transaction not found');
  return t;
}
