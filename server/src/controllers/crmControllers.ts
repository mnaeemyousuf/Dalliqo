import type { Request, Response } from 'express';
import { authOf } from '../middleware/authenticate';
import { activityService } from '../services/activityService';
import { branchService } from '../services/branchService';
import { categoryService } from '../services/categoryService';
import { dealService } from '../services/dealService';
import { clientService } from '../services/clientService';
import { dashboardService } from '../services/dashboardService';
import { exportService, type ExportFormat, type ExportResource } from '../services/exportService';
import { followUpService } from '../services/followUpService';
import { matchingService } from '../services/matching/matchingService';
import { mediaService, type UploadedFile } from '../services/mediaService';
import { noteService } from '../services/noteService';
import { notificationService } from '../services/notificationService';
import { ownerService } from '../services/ownerService';
import { propertyService } from '../services/propertyService';
import { pushService } from '../services/pushService';
import { searchService } from '../services/searchService';
import { settingsService } from '../services/settingsService';
import { syncService } from '../services/syncService';
import { transactionService } from '../services/transactionService';
import { agreementService } from '../services/agreementService';
import { brochureService, type BrochureOptions } from '../services/brochureService';
import { clientRepository, propertyRepository } from '../repositories/entityRepositories';
import { leadImportFields, propertyImportFields, clientListQuery, dealListQuery, documentUploadFields, agreementListQuery, financeReportQuery, followUpListQuery, matchListQuery, ownerListQuery, propertyListQuery, transactionListQuery } from '../validators/crm.schemas';
import type { ZodTypeAny } from 'zod';

const EXPORT_FILTERS: Record<ExportResource, ZodTypeAny> = {
  clients: clientListQuery,
  properties: propertyListQuery,
  owners: ownerListQuery,
  followups: followUpListQuery,
  matches: matchListQuery,
  deals: dealListQuery,
  commissions: dealListQuery,
  transactions: transactionListQuery,
  finance: financeReportQuery,
  agreements: agreementListQuery,
};
import { badRequest, forbidden } from '../utils/AppError';
import { ERROR_CODES, PERMISSIONS } from '@recrm/shared';
import { leadService } from '../services/leadService';
import { verificationService } from '../services/verificationService';
import { leaseService } from '../services/leaseService';
import { installmentService } from '../services/installmentService';
import { financeReportService } from '../services/financeReportService';
import { inventoryToolsService } from '../services/inventoryToolsService';
import { redactOwner } from '../services/ownerService';
import { pageMeta, sendSuccess } from '../utils/http';
import { requestMeta } from './authController';

type Q = Record<string, never>;
const query = <T>(req: Request) => req.query as unknown as T & { page: number; limit: number };
const list = <T>(res: Response, page: number, limit: number, r: { items: T[]; total: number }, extra?: Record<string, unknown>) =>
  sendSuccess(res, r.items, { meta: { ...pageMeta(page, limit, r.total), ...extra } });

/** Splits the optional optimistic-concurrency version out of a write body. */
function versioned<T extends { baseVersion?: number }>(req: Request): { body: Omit<T, 'baseVersion'>; baseVersion?: number } {
  const header = req.get('if-match');
  const { baseVersion, ...body } = req.body as T;
  return { body, baseVersion: baseVersion ?? (header && /^\d+$/.test(header) ? Number(header) : undefined) };
}

export const branchController = {
  async list(req: Request, res: Response) {
    const auth = authOf(req);
    const items = await branchService.list(auth, { includeArchived: Boolean((req.query as { includeArchived?: boolean }).includeArchived) });
    const counts = auth.permissions.includes('branches:manage') ? await branchService.memberCounts(auth) : {};
    sendSuccess(res, items.map((b) => ({ ...b, memberCount: counts[String(b._id)] ?? 0 })));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await branchService.get(authOf(req), req.params.id));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await branchService.create(authOf(req), req.body, requestMeta(req)), { status: 201, message: 'Branch created' });
  },
  async update(req: Request, res: Response) {
    const { body, baseVersion } = versioned(req);
    sendSuccess(res, await branchService.update(authOf(req), req.params.id, body, { baseVersion, meta: requestMeta(req) }), { message: 'Branch updated' });
  },
};

export const agreementController = {
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    list(res, q.page, q.limit, await agreementService.list(authOf(req), q));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await agreementService.get(authOf(req), req.params.id));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await agreementService.create(authOf(req), req.body, requestMeta(req)), { status: 201, message: 'Agreement drafted' });
  },
  async update(req: Request, res: Response) {
    const { body, baseVersion } = versioned(req);
    sendSuccess(res, await agreementService.update(authOf(req), req.params.id, body, { baseVersion, meta: requestMeta(req) }), { message: 'Agreement updated' });
  },
  async render(req: Request, res: Response) {
    sendSuccess(res, await agreementService.render(authOf(req), req.params.id, req.body), { status: 201, message: 'New version generated' });
  },
  async addVersion(req: Request, res: Response) {
    sendSuccess(res, await agreementService.addVersion(authOf(req), req.params.id, (req.body as { body: string }).body), { status: 201, message: 'Version saved' });
  },
  async status(req: Request, res: Response) {
    sendSuccess(res, await agreementService.changeStatus(authOf(req), req.params.id, req.body, { meta: requestMeta(req) }), { message: 'Status changed' });
  },
  async remove(req: Request, res: Response) {
    const { baseVersion } = versioned(req);
    await agreementService.remove(authOf(req), req.params.id, { baseVersion, meta: requestMeta(req) });
    sendSuccess(res, null, { message: 'Agreement deleted' });
  },
  async pdf(req: Request, res: Response) {
    const auth = authOf(req);
    const a = await agreementService.get(auth, req.params.id);
    const v = (req.query as { version?: number }).version;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${a.agreementNo}-v${v ?? a.versions.at(-1)?.no ?? 0}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    await agreementService.pdf(auth, req.params.id, res, v);
  },
  async templates(req: Request, res: Response) {
    sendSuccess(res, await agreementService.templates(authOf(req), req.query as never));
  },
  async createTemplate(req: Request, res: Response) {
    sendSuccess(res, await agreementService.createTemplate(authOf(req), req.body), { status: 201, message: 'Template added' });
  },
  async updateTemplate(req: Request, res: Response) {
    sendSuccess(res, await agreementService.updateTemplate(authOf(req), req.params.id, req.body), { message: 'Template updated' });
  },
};

export const refundController = {
  async refund(req: Request, res: Response) {
    sendSuccess(res, await transactionService.refund(authOf(req), req.params.id, req.body, requestMeta(req)), { status: 201, message: 'Refund recorded' });
  },
};

export const transactionController = {
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    list(res, q.page, q.limit, await transactionService.list(authOf(req), q));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await transactionService.get(authOf(req), req.params.id));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await transactionService.create(authOf(req), req.body, requestMeta(req)), { status: 201, message: 'Entry recorded' });
  },
  async update(req: Request, res: Response) {
    const { body, baseVersion } = versioned(req);
    sendSuccess(res, await transactionService.update(authOf(req), req.params.id, body, { baseVersion, meta: requestMeta(req) }), { message: 'Entry updated' });
  },
  async remove(req: Request, res: Response) {
    const { baseVersion } = versioned(req);
    await transactionService.remove(authOf(req), req.params.id, { baseVersion, meta: requestMeta(req) });
    sendSuccess(res, null, { message: 'Entry deleted' });
  },
  async categories(req: Request, res: Response) {
    sendSuccess(res, await transactionService.categories(authOf(req), Boolean(query<{ includeArchived?: boolean }>(req).includeArchived)));
  },
  async createCategory(req: Request, res: Response) {
    sendSuccess(res, await transactionService.createCategory(authOf(req), req.body), { status: 201, message: 'Category added' });
  },
  async updateCategory(req: Request, res: Response) {
    sendSuccess(res, await transactionService.updateCategory(authOf(req), req.params.id, req.body), { message: 'Category updated' });
  },
  async report(req: Request, res: Response) {
    sendSuccess(res, await transactionService.report(authOf(req), req.query as never));
  },
};

export const negotiationController = {
  async addOffer(req: Request, res: Response) {
    sendSuccess(res, await dealService.addOffer(authOf(req), req.params.id, req.body, requestMeta(req)), { status: 201, message: 'Offer recorded' });
  },
  async respond(req: Request, res: Response) {
    sendSuccess(res, await dealService.respondToOffer(authOf(req), req.params.id, req.params.subId, req.body.status, requestMeta(req)));
  },
  async approveCommission(req: Request, res: Response) {
    sendSuccess(res, await dealService.approveCommission(authOf(req), req.params.id, requestMeta(req)));
  },
  async payExternal(req: Request, res: Response) {
    sendSuccess(res, await dealService.payExternal(authOf(req), req.params.id, req.params.subId, req.body.amount, requestMeta(req)));
  },
  async approval(req: Request, res: Response) {
    sendSuccess(res, await dealService.decideApproval(authOf(req), req.params.id, req.body.decision, req.body.note, requestMeta(req)));
  },
  async checklist(req: Request, res: Response) {
    sendSuccess(res, await dealService.setChecklistItem(authOf(req), req.params.id, req.body.key, req.body.done, req.body.label, requestMeta(req)));
  },
};

export const dealController = {
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    list(res, q.page, q.limit, await dealService.list(authOf(req), q));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await dealService.get(authOf(req), req.params.id));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await dealService.create(authOf(req), req.body, requestMeta(req)), { status: 201, message: 'Deal created' });
  },
  async update(req: Request, res: Response) {
    const { body, baseVersion } = versioned(req);
    sendSuccess(res, await dealService.update(authOf(req), req.params.id, body, { baseVersion, meta: requestMeta(req) }), { message: 'Deal updated' });
  },
  async stage(req: Request, res: Response) {
    const { stage, note, lostReason, baseVersion } = req.body as { stage: never; note?: string; lostReason?: string; baseVersion?: number };
    sendSuccess(res, await dealService.changeStage(authOf(req), req.params.id, stage, { note, lostReason, baseVersion, meta: requestMeta(req) }), { message: 'Stage changed' });
  },
  async addPayment(req: Request, res: Response) {
    sendSuccess(res, await dealService.addPayment(authOf(req), req.params.id, req.body, requestMeta(req)), { status: 201, message: 'Payment recorded' });
  },
  async removePayment(req: Request, res: Response) {
    sendSuccess(res, await dealService.removePayment(authOf(req), req.params.id, req.params.subId, requestMeta(req)), { message: 'Payment removed' });
  },
  async addPayout(req: Request, res: Response) {
    sendSuccess(res, await dealService.addPayout(authOf(req), req.params.id, req.body, requestMeta(req)), { status: 201, message: 'Payout recorded' });
  },
  async updatePayout(req: Request, res: Response) {
    sendSuccess(res, await dealService.updatePayout(authOf(req), req.params.id, req.params.subId, req.body, requestMeta(req)), { message: 'Payout updated' });
  },
  async remove(req: Request, res: Response) {
    const { baseVersion } = versioned(req);
    await dealService.remove(authOf(req), req.params.id, { baseVersion, meta: requestMeta(req) });
    sendSuccess(res, null, { message: 'Deal deleted' });
  },
  async report(req: Request, res: Response) {
    sendSuccess(res, await dealService.report(authOf(req), req.query as never));
  },
};

export const categoryController = {
  async list(req: Request, res: Response) {
    sendSuccess(res, await categoryService.list(authOf(req), Boolean((req.query as { includeArchived?: boolean }).includeArchived)));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await categoryService.create(authOf(req), req.body), { status: 201, message: 'Category created successfully' });
  },
  async update(req: Request, res: Response) {
    sendSuccess(res, await categoryService.update(authOf(req), req.params.id, req.body), { message: 'Category updated successfully' });
  },
};

export const installmentController = {
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    list(res, q.page, q.limit, await installmentService.list(authOf(req), q));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await installmentService.get(authOf(req), req.params.id));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await installmentService.create(authOf(req), req.body, requestMeta(req)), { status: 201, message: 'Installment plan created' });
  },
  async pay(req: Request, res: Response) {
    sendSuccess(res, await installmentService.recordPayment(authOf(req), req.params.id, req.body, requestMeta(req)), { message: 'Payment recorded' });
  },
  async cancel(req: Request, res: Response) {
    sendSuccess(res, await installmentService.cancel(authOf(req), req.params.id, req.body.reason));
  },
};

export const financeReportController = {
  async cashFlow(req: Request, res: Response) {
    sendSuccess(res, await financeReportService.cashFlow(authOf(req), req.query as never));
  },
  async aging(req: Request, res: Response) {
    sendSuccess(res, await financeReportService.aging(authOf(req)));
  },
  async agentStatement(req: Request, res: Response) {
    const q = req.query as unknown as { userId: string; from?: Date; to?: Date; format?: 'json' | 'pdf' };
    if (q.format === 'pdf') {
      const { PassThrough } = await import('node:stream');
      const buf = new PassThrough();
      const chunks: Buffer[] = [];
      buf.on('data', (c: Buffer) => chunks.push(c));
      const done = new Promise<void>((r) => buf.on('end', () => r()));
      await financeReportService.agentStatementPdf(authOf(req), q.userId, q, buf);
      await done;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="commission-statement.pdf"');
      res.end(Buffer.concat(chunks));
      return;
    }
    sendSuccess(res, await financeReportService.agentStatement(authOf(req), q.userId, q));
  },
  async incomeStatement(req: Request, res: Response) {
    sendSuccess(res, await financeReportService.incomeStatement(authOf(req), req.query as never));
  },
  async voucher(req: Request, res: Response) {
    const { kind, id: rid, subId } = req.params as { kind: 'transaction' | 'payout'; id: string; subId?: string };
    const { PassThrough } = await import('node:stream');
    const buf = new PassThrough();
    const chunks: Buffer[] = [];
    buf.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((r) => buf.on('end', () => r()));
    await financeReportService.voucherPdf(authOf(req), kind, rid, subId, buf);
    await done;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="payment-voucher.pdf"');
    res.end(Buffer.concat(chunks));
  },
  async receipt(req: Request, res: Response) {
    const { kind, id: rid, paymentId } = req.params as { kind: 'lease' | 'installment' | 'deal'; id: string; paymentId: string };
    const { PassThrough } = await import('node:stream');
    const buf = new PassThrough();
    const chunks: Buffer[] = [];
    buf.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((r) => buf.on('end', () => r()));
    await financeReportService.receiptPdf(authOf(req), kind, rid, paymentId, buf);
    await done;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${paymentId.slice(0, 8)}.pdf"`);
    res.end(Buffer.concat(chunks));
  },
};

export const leaseExtraController = {
  async addNotice(req: Request, res: Response) {
    sendSuccess(res, await leaseService.addNotice(authOf(req), req.params.id, req.body), { status: 201, message: 'Notice recorded' });
  },
  async expenses(req: Request, res: Response) {
    sendSuccess(res, await leaseService.expenses(authOf(req), req.params.id));
  },
  async noticePdf(req: Request, res: Response) {
    const { PassThrough } = await import('node:stream');
    const buf = new PassThrough();
    const chunks: Buffer[] = [];
    buf.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((r) => buf.on('end', () => r()));
    await financeReportService.noticePdf(authOf(req), req.params.id, req.params.subId, buf);
    await done;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="tenant-notice.pdf"');
    res.end(Buffer.concat(chunks));
  },
};

export const leaseController = {
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    list(res, q.page, q.limit, await leaseService.list(authOf(req), q));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await leaseService.get(authOf(req), req.params.id));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await leaseService.create(authOf(req), req.body, requestMeta(req)), { status: 201, message: 'Lease created' });
  },
  async pay(req: Request, res: Response) {
    sendSuccess(res, await leaseService.recordPayment(authOf(req), req.params.id, req.body, requestMeta(req)), { message: 'Rent recorded' });
  },
  async waive(req: Request, res: Response) {
    sendSuccess(res, await leaseService.waive(authOf(req), req.params.id, req.body.itemId, req.body.reason));
  },
  async inspect(req: Request, res: Response) {
    sendSuccess(res, await leaseService.addInspection(authOf(req), req.params.id, req.body));
  },
  async renew(req: Request, res: Response) {
    sendSuccess(res, await leaseService.renew(authOf(req), req.params.id, req.body));
  },
  async end(req: Request, res: Response) {
    sendSuccess(res, await leaseService.end(authOf(req), req.params.id, req.body));
  },
  async rentRoll(req: Request, res: Response) {
    sendSuccess(res, await leaseService.rentRoll(authOf(req)));
  },
};

export const verificationController = {
  async get(req: Request, res: Response) {
    sendSuccess(res, await verificationService.get(authOf(req), req.params.id));
  },
  async submit(req: Request, res: Response) {
    sendSuccess(res, await verificationService.submit(authOf(req), req.params.id, req.body.note, requestMeta(req)), { message: 'Submitted for verification' });
  },
  async assign(req: Request, res: Response) {
    sendSuccess(res, await verificationService.assign(authOf(req), req.params.id, req.body.userId, requestMeta(req)));
  },
  async checklist(req: Request, res: Response) {
    sendSuccess(res, await verificationService.setChecklistItem(authOf(req), req.params.id, req.body.key, req.body.done, req.body.note));
  },
  async decide(req: Request, res: Response) {
    const b = req.body as { decision: never; remarks?: string; nextVerificationAt?: Date | null };
    sendSuccess(res, await verificationService.decide(authOf(req), req.params.id, b.decision, b.remarks, b.nextVerificationAt, requestMeta(req)));
  },
  async queue(req: Request, res: Response) {
    const q = query<{ status?: never; mine?: boolean }>(req);
    list(res, q.page, q.limit, await verificationService.queue(authOf(req), q));
  },
};

export const inventoryToolsController = {
  async template(_req: Request, res: Response) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="stateown-properties-template.xlsx"');
    res.end(await inventoryToolsService.propertyTemplate());
  },
  async importExcel(req: Request, res: Response) {
    const file = req.file as { buffer: Buffer } | undefined;
    if (!file) throw badRequest(ERROR_CODES.INVALID_FILE, 'No file received');
    const opts = propertyImportFields.parse(req.body ?? {});
    sendSuccess(res, await inventoryToolsService.importProperties(authOf(req), file.buffer, opts), { message: 'Import finished' });
  },
  async qr(req: Request, res: Response) {
    const r = await inventoryToolsService.propertyQr(authOf(req), req.params.id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="${r.fileName}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(r.png);
  },
  async views(req: Request, res: Response) {
    sendSuccess(res, await inventoryToolsService.listViews(authOf(req), (req.query as { page: never }).page));
  },
  async createView(req: Request, res: Response) {
    sendSuccess(res, await inventoryToolsService.createView(authOf(req), req.body), { status: 201 });
  },
  async removeView(req: Request, res: Response) {
    await inventoryToolsService.removeView(authOf(req), req.params.id);
    sendSuccess(res, null);
  },
};

export const leadController = {
  async assign(req: Request, res: Response) {
    sendSuccess(res, await leadService.assign(authOf(req), req.params.id, req.body.userId, req.body.note), { message: 'Lead assigned' });
  },
  async report(req: Request, res: Response) {
    sendSuccess(res, await leadService.report(authOf(req), req.query as never));
  },
  async template(_req: Request, res: Response) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="stateown-leads-template.xlsx"');
    res.end(await leadService.template());
  },
  async importExcel(req: Request, res: Response) {
    const file = req.file as { buffer: Buffer } | undefined;
    if (!file) throw badRequest(ERROR_CODES.INVALID_FILE, 'No file received');
    const opts = leadImportFields.parse(req.body ?? {});
    sendSuccess(res, await leadService.importExcel(authOf(req), file.buffer, opts), { message: 'Import finished' });
  },
};

export const clientController = {
  async duplicates(req: Request, res: Response) {
    const q = query<{ phone: string | string[]; excludeId?: string }>(req);
    sendSuccess(res, await clientService.findDuplicates(authOf(req), Array.isArray(q.phone) ? q.phone : [q.phone], q.excludeId));
  },
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    list(res, q.page, q.limit, await clientService.list(authOf(req), q));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await clientService.get(authOf(req), req.params.id));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await clientService.create(authOf(req), req.body, requestMeta(req)), { status: 201, message: 'Client created successfully' });
  },
  async update(req: Request, res: Response) {
    const { body, baseVersion } = versioned(req);
    sendSuccess(res, await clientService.update(authOf(req), req.params.id, body, { baseVersion, meta: requestMeta(req) }), { message: 'Client updated successfully' });
  },
  async remove(req: Request, res: Response) {
    const { baseVersion } = versioned(req);
    await clientService.remove(authOf(req), req.params.id, { baseVersion, meta: requestMeta(req) });
    sendSuccess(res, null, { message: 'Client deleted' });
  },
  async communicate(req: Request, res: Response) {
    sendSuccess(res, await clientService.logCommunication(authOf(req), req.params.id, req.body.channel, req.body.note), { message: 'Contact recorded' });
  },
  async matches(req: Request, res: Response) {
    const auth = authOf(req);
    await clientRepository.getById(auth, req.params.id, 'Client not found');
    const q = query<Q>(req);
    list(res, q.page, q.limit, await matchingService.list(auth, { ...q, clientId: req.params.id }));
  },
};

export const ownerController = {
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    const auth = authOf(req);
    const see = auth.permissions.includes(PERMISSIONS.DOCUMENTS_SENSITIVE);
    const r = await ownerService.list(auth, q);
    list(res, q.page, q.limit, { ...r, items: r.items.map((o) => redactOwner(see, o)) });
  },
  async get(req: Request, res: Response) {
    const auth = authOf(req);
    sendSuccess(res, redactOwner(auth.permissions.includes(PERMISSIONS.DOCUMENTS_SENSITIVE), await ownerService.get(auth, req.params.id)));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await ownerService.create(authOf(req), req.body, requestMeta(req)), { status: 201, message: 'Owner created successfully' });
  },
  async update(req: Request, res: Response) {
    const { body, baseVersion } = versioned(req);
    sendSuccess(res, await ownerService.update(authOf(req), req.params.id, body, { baseVersion, meta: requestMeta(req) }), { message: 'Owner updated successfully' });
  },
  async remove(req: Request, res: Response) {
    const { baseVersion } = versioned(req);
    await ownerService.remove(authOf(req), req.params.id, { baseVersion, meta: requestMeta(req) });
    sendSuccess(res, null, { message: 'Owner deleted' });
  },
};

export const propertyController = {
  /** Brochure: PDF, 1080×1350 PNG or share text (JSON). */
  async brochure(req: Request, res: Response) {
    const o = req.query as unknown as BrochureOptions;
    if (o.format === 'text') {
      const r = await brochureService.generate(authOf(req), req.params.id, o);
      sendSuccess(res, { text: r.text, whatsappUrl: r.whatsappUrl });
      return;
    }
    const { PassThrough } = await import('node:stream');
    const buffer = new PassThrough();
    const chunks: Buffer[] = [];
    buffer.on('data', (c: Buffer) => chunks.push(c));
    // Generated fully before headers are sent, so failures still return a proper JSON error.
    const done = new Promise<void>((resolve) => buffer.on('end', () => resolve()));
    const r = await brochureService.generate(authOf(req), req.params.id, o, buffer);
    await done;
    res.setHeader('Content-Type', r.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${r.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.concat(chunks));
  },
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    const auth = authOf(req);
    const floor = auth.permissions.includes(PERMISSIONS.PROPERTIES_VIEW_FLOOR);
    const r = await propertyService.list(auth, q);
    list(res, q.page, q.limit, { ...r, items: r.items.map((p) => propertyService.redact(floor, p)) });
  },
  async get(req: Request, res: Response) {
    const auth = authOf(req);
    sendSuccess(res, propertyService.redact(auth.permissions.includes(PERMISSIONS.PROPERTIES_VIEW_FLOOR), await propertyService.get(auth, req.params.id)));
  },
  async duplicates(req: Request, res: Response) {
    const q = req.query as unknown as { excludeId?: string; plotNumber: string };
    sendSuccess(res, await propertyService.findDuplicates(authOf(req), q, q.excludeId));
  },
  async inventoryReport(req: Request, res: Response) {
    sendSuccess(res, await propertyService.inventoryReport(authOf(req)));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await propertyService.create(authOf(req), req.body, requestMeta(req)), { status: 201, message: 'Property created successfully' });
  },
  async update(req: Request, res: Response) {
    const { body, baseVersion } = versioned(req);
    sendSuccess(res, await propertyService.update(authOf(req), req.params.id, body, { baseVersion, meta: requestMeta(req) }), { message: 'Property updated successfully' });
  },
  async verify(req: Request, res: Response) {
    sendSuccess(res, await propertyService.verify(authOf(req), req.params.id, req.body?.note, requestMeta(req)), { message: 'Availability confirmed' });
  },
  async changeStatus(req: Request, res: Response) {
    const { body, baseVersion } = versioned<{ status: never; reason?: string; baseVersion?: number }>(req);
    const p = await propertyService.changeStatus(authOf(req), req.params.id, body.status, body.reason, { baseVersion, meta: requestMeta(req) });
    sendSuccess(res, p, { message: 'Status updated' });
  },
  async remove(req: Request, res: Response) {
    const { baseVersion } = versioned(req);
    await propertyService.remove(authOf(req), req.params.id, { baseVersion, meta: requestMeta(req) });
    sendSuccess(res, null, { message: 'Property deleted' });
  },
  async matches(req: Request, res: Response) {
    const auth = authOf(req);
    await propertyRepository.getById(auth, req.params.id, 'Property not found');
    const q = query<Q>(req);
    list(res, q.page, q.limit, await matchingService.list(auth, { ...q, propertyId: req.params.id }));
  },
  async listMedia(req: Request, res: Response) {
    const auth = authOf(req);
    await propertyRepository.getById(auth, req.params.id, 'Property not found');
    sendSuccess(res, await mediaService.listPropertyMedia(auth, req.params.id));
  },
  async uploadMedia(req: Request, res: Response) {
    const files = (req.files as UploadedFile[] | undefined) ?? [];
    sendSuccess(res, await mediaService.uploadPropertyMedia(authOf(req), req.params.id, files), { status: 201, message: 'Media uploaded successfully' });
  },
};

export const mediaController = {
  async update(req: Request, res: Response) {
    sendSuccess(res, await mediaService.updateMedia(authOf(req), req.params.id, req.body), { message: 'Media updated' });
  },
  async remove(req: Request, res: Response) {
    await mediaService.removeMedia(authOf(req), req.params.id);
    sendSuccess(res, null, { message: 'Media deleted' });
  },
};

export const documentController = {
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    list(res, q.page, q.limit, await mediaService.listDocuments(authOf(req), q));
  },
  async upload(req: Request, res: Response) {
    const fields = documentUploadFields.parse(req.body);
    const doc = await mediaService.uploadDocument(authOf(req), fields, req.file as UploadedFile | undefined);
    sendSuccess(res, doc, { status: 201, message: 'Document uploaded successfully' });
  },
  async download(req: Request, res: Response) {
    sendSuccess(res, await mediaService.downloadUrl(authOf(req), req.params.id));
  },
  async update(req: Request, res: Response) {
    sendSuccess(res, await mediaService.updateDocument(authOf(req), req.params.id, req.body), { message: 'Document updated' });
  },
  async remove(req: Request, res: Response) {
    await mediaService.removeDocument(authOf(req), req.params.id);
    sendSuccess(res, null, { message: 'Document deleted' });
  },
};

// Reading notes needs read access to the record they belong to (every entity type that can hold notes).
const NOTE_READ: Record<string, string> = { client: 'clients:read', property: 'properties:read', owner: 'owners:read', followUp: 'followups:read', deal: 'deals:read', transaction: 'finance:read', agreement: 'agreements:read', lease: 'rentals:read' };

export const noteController = {
  async list(req: Request, res: Response) {
    const q = query<{ entityType: never; entityId: string }>(req);
    if (!authOf(req).permissions.includes(NOTE_READ[q.entityType] as never)) throw forbidden();
    list(res, q.page, q.limit, await noteService.list(authOf(req), q));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await noteService.create(authOf(req), req.body), { status: 201, message: 'Note added' });
  },
  async update(req: Request, res: Response) {
    sendSuccess(res, await noteService.update(authOf(req), req.params.id, req.body.content, req.body.baseVersion), { message: 'Note updated' });
  },
  async remove(req: Request, res: Response) {
    await noteService.remove(authOf(req), req.params.id);
    sendSuccess(res, null, { message: 'Note deleted' });
  },
};

export const activityController = {
  async list(req: Request, res: Response) {
    const q = query<{ entityId?: string }>(req);
    list(res, q.page, q.limit, await activityService.list(authOf(req), q));
  },
};

export const matchController = {
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    list(res, q.page, q.limit, await matchingService.list(authOf(req), q));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await matchingService.get(authOf(req), req.params.id));
  },
  async update(req: Request, res: Response) {
    sendSuccess(res, await matchingService.setStatus(authOf(req), req.params.id, req.body.status), { message: 'Match updated' });
  },
  async recalculate(req: Request, res: Response) {
    const auth = authOf(req);
    const { clientId, propertyId } = req.body as { clientId?: string; propertyId?: string };
    if (clientId) {
      const created = await matchingService.recalcForClient(auth, await clientRepository.getById(auth, clientId, 'Client not found'));
      return sendSuccess(res, { created: created.length }, { message: 'Matches recalculated' });
    }
    if (propertyId) {
      const created = await matchingService.recalcForProperty(auth, await propertyRepository.getById(auth, propertyId, 'Property not found'));
      return sendSuccess(res, { created: created.length }, { message: 'Matches recalculated' });
    }
    sendSuccess(res, await matchingService.recalcAll(auth), { message: 'All matches recalculated' });
  },
};

export const settingsController = {
  async get(req: Request, res: Response) {
    sendSuccess(res, await settingsService.get(authOf(req)));
  },
  async update(req: Request, res: Response) {
    const auth = authOf(req);
    const before = await settingsService.get(auth);
    const next = await settingsService.update(auth, req.body, req.ip);
    // New weights or thresholds change every score.
    if (JSON.stringify(before.matching) !== JSON.stringify(next.matching) || JSON.stringify(before.sqftPerUnit) !== JSON.stringify(next.sqftPerUnit)) {
      await matchingService.recalcAll(auth);
    }
    sendSuccess(res, next, { message: 'Settings updated' });
  },
};

export const followUpController = {
  async list(req: Request, res: Response) {
    const auth = authOf(req);
    const q = query<{ assignedTo?: string }>(req);
    if (q.assignedTo === 'me') q.assignedTo = auth.userId;
    list(res, q.page, q.limit, await followUpService.list(auth, q));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await followUpService.get(authOf(req), req.params.id));
  },
  async create(req: Request, res: Response) {
    sendSuccess(res, await followUpService.create(authOf(req), req.body), { status: 201, message: 'Follow-up created successfully' });
  },
  async update(req: Request, res: Response) {
    const { body, baseVersion } = versioned(req);
    sendSuccess(res, await followUpService.update(authOf(req), req.params.id, body as never, baseVersion), { message: 'Follow-up updated' });
  },
  async complete(req: Request, res: Response) {
    sendSuccess(res, await followUpService.complete(authOf(req), req.params.id, req.body.outcome, req.body.baseVersion), { message: 'Follow-up completed' });
  },
  async remove(req: Request, res: Response) {
    await followUpService.remove(authOf(req), req.params.id);
    sendSuccess(res, null, { message: 'Follow-up deleted' });
  },
};

export const notificationController = {
  async list(req: Request, res: Response) {
    const q = query<{ category?: never; unread?: boolean }>(req);
    const r = await notificationService.list(authOf(req), q);
    list(res, q.page, q.limit, r, { unreadCount: r.unreadCount });
  },
  async read(req: Request, res: Response) {
    sendSuccess(res, await notificationService.markRead(authOf(req), req.params.id));
  },
  async readAll(req: Request, res: Response) {
    sendSuccess(res, await notificationService.markAllRead(authOf(req), req.body.category), { message: 'All notifications marked as read' });
  },
  async registerDevice(req: Request, res: Response) {
    const auth = authOf(req);
    await pushService.registerDevice({ userId: auth.userId, businessId: auth.businessId, sessionId: auth.sessionId, ...req.body });
    sendSuccess(res, { pushEnabled: pushService.enabled }, { message: 'Device registered' });
  },
  async unregisterDevice(req: Request, res: Response) {
    await pushService.unregisterDevice(authOf(req).userId, req.params.token);
    sendSuccess(res, null, { message: 'Device removed' });
  },
};

export const dashboardController = {
  async summary(req: Request, res: Response) {
    const auth = authOf(req);
    // Deal figures depend on who asks (agents only count their own deals), so they are not cached with the rest.
    const [summary, deals, finance, agreements] = await Promise.all([
      dashboardService.summary(auth),
      auth.permissions.includes('deals:read') ? dealService.stats(auth) : Promise.resolve(undefined),
      auth.permissions.includes('finance:read') ? transactionService.stats(auth) : Promise.resolve(undefined),
      auth.permissions.includes('agreements:read') ? agreementService.stats(auth) : Promise.resolve(undefined),
    ]);
    sendSuccess(res, { ...summary, ...(deals ? { deals } : {}), ...(finance ? { finance } : {}), ...(agreements ? { agreements } : {}) });
  },
  async analytics(req: Request, res: Response) {
    sendSuccess(res, await dashboardService.analytics(authOf(req), (req.query as { range: '7d' | '30d' | '12m' }).range));
  },
  async myDay(req: Request, res: Response) {
    sendSuccess(res, await dashboardService.myDay(authOf(req), (req.query as { scope: 'mine' | 'all' }).scope));
  },
  async search(req: Request, res: Response) {
    const q = req.query as unknown as { q: string; types: never[]; limit: number };
    sendSuccess(res, await searchService.search(authOf(req), q.q, q.types, q.limit));
  },
};

export const exportController = {
  async download(req: Request, res: Response) {
    const resource = req.params.resource as ExportResource;
    const { format, ...raw } = req.query as { format: ExportFormat } & Record<string, unknown>;
    // Same validation as the list endpoints; page/limit are irrelevant for exports.
    const { page: _p, limit: _l, ...filters } = EXPORT_FILTERS[resource].parse(raw) as Record<string, unknown>;
    if (filters.assignedTo === 'me') filters.assignedTo = authOf(req).userId;
    const prepared = await exportService.prepare(authOf(req), resource, filters);
    res.setHeader('Content-Type', exportService.contentType(format));
    res.setHeader('Content-Disposition', `attachment; filename="${exportService.fileName(resource, format)}"`);
    res.setHeader('Cache-Control', 'no-store');
    await exportService.write(res, format, prepared, filters);
  },
};

export const syncController = {
  async push(req: Request, res: Response) {
    sendSuccess(res, { results: await syncService.push(authOf(req), req.body.mutations) });
  },
  async pull(req: Request, res: Response) {
    const q = req.query as unknown as { cursor?: string; limit: number };
    sendSuccess(res, await syncService.pull(authOf(req), q.cursor, q.limit));
  },
  async bootstrap(req: Request, res: Response) {
    sendSuccess(res, await syncService.bootstrap(authOf(req)));
  },
};
