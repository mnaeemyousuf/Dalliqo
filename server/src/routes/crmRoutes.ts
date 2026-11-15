import { Router } from 'express';
import multer from 'multer';
import { PERMISSIONS as P } from '@recrm/shared';
import { env } from '../config/env';
import {
  activityController,
  branchController,
  categoryController,
  clientController,
  leadController,
  verificationController,
  leaseController,
  installmentController,
  financeReportController,
  refundController,
  leaseExtraController,
  inventoryToolsController,
  negotiationController,
  dealController,
  transactionController,
  agreementController,
  dashboardController,
  documentController,
  exportController,
  followUpController,
  matchController,
  mediaController,
  noteController,
  notificationController,
  ownerController,
  propertyController,
  settingsController,
  syncController,
} from '../controllers/crmControllers';
import { requirePermission as can } from '../middleware/authorize';
import { authOf } from '../middleware/authenticate';
import { teamDashboardService } from '../services/teamDashboardService';
import { performanceService, type PeriodFilter } from '../services/performanceService';
import { agentPerformancePdf, agentPerformanceXlsx } from '../services/performanceExport';
import { dealService } from '../services/dealService';
import { settingsService } from '../services/settingsService';
import { sendSuccess } from '../utils/http';
import { validate } from '../middleware/validate';
import { asyncHandler as h } from '../utils/http';
import { idParams } from '../validators/common';
import * as s from '../validators/crm.schemas';

/** Files are held in memory only long enough to be validated, processed and sent to storage. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(env.MAX_VIDEO_MB, env.MAX_DOCUMENT_MB, env.MAX_IMAGE_MB) * 1024 * 1024, files: 10, fields: 20 },
});

const id = validate({ params: idParams });
const r = Router();

// Dashboard, My Day, search
r.get('/dashboard', h(dashboardController.summary));
r.get('/dashboard/team', h(async (req, res) => sendSuccess(res, await teamDashboardService.team(authOf(req)))));
r.get('/dashboard/analytics', can(P.REPORTS_READ), validate({ query: s.analyticsQuery }), h(dashboardController.analytics));
r.get('/my-day', validate({ query: s.myDayQuery }), h(dashboardController.myDay));
r.get('/search', validate({ query: s.searchQuery }), h(dashboardController.search));

// Branches (any member may list the branches they can see; managing needs branches:manage)
r.get('/branches', validate({ query: s.branchListQuery }), h(branchController.list));
r.post('/branches', can(P.BRANCHES_MANAGE), validate({ body: s.branchCreateSchema }), h(branchController.create));
r.get('/branches/:id', id, h(branchController.get));
r.patch('/branches/:id', can(P.BRANCHES_MANAGE), validate({ params: idParams, body: s.branchUpdateSchema }), h(branchController.update));

// Client categories
r.get('/client-categories', can(P.CLIENTS_READ), validate({ query: s.categoryListQuery }), h(categoryController.list));
r.post('/client-categories', can(P.SETTINGS_MANAGE), validate({ body: s.categoryCreateSchema }), h(categoryController.create));
r.patch('/client-categories/:id', can(P.SETTINGS_MANAGE), validate({ params: idParams, body: s.categoryUpdateSchema }), h(categoryController.update));

// Clients
r.get('/clients', can(P.CLIENTS_READ), validate({ query: s.clientListQuery }), h(clientController.list));
r.post('/clients', can(P.CLIENTS_CREATE), validate({ body: s.clientCreateSchema }), h(clientController.create));
r.get('/clients/duplicates', can(P.CLIENTS_READ), validate({ query: s.duplicateClientQuery }), h(clientController.duplicates));
r.get('/clients/import/template', can(P.CLIENTS_CREATE), h(leadController.template));
r.post('/clients/import', can(P.CLIENTS_CREATE), upload.single('file'), h(leadController.importExcel));
r.post('/clients/:id/assign', can(P.CLIENTS_UPDATE), validate({ params: idParams, body: s.leadAssignSchema }), h(leadController.assign));
r.get('/reports/leads', can(P.CLIENTS_READ, P.REPORTS_READ), validate({ query: s.leadReportQuery }), h(leadController.report));
r.get('/reports/inventory', can(P.PROPERTIES_READ, P.REPORTS_READ), h(propertyController.inventoryReport));
r.get('/clients/:id', can(P.CLIENTS_READ), id, h(clientController.get));
r.patch('/clients/:id', can(P.CLIENTS_UPDATE), validate({ params: idParams, body: s.clientUpdateSchema }), h(clientController.update));
r.delete('/clients/:id', can(P.CLIENTS_DELETE), id, h(clientController.remove));
r.post('/clients/:id/communications', can(P.CLIENTS_READ), validate({ params: idParams, body: s.communicationSchema }), h(clientController.communicate));
r.get('/clients/:id/matches', can(P.MATCHES_READ), validate({ params: idParams, query: s.matchListQuery }), h(clientController.matches));

// Deals & commission (agents without deals:read_all only see their own deals; enforced in the service)
r.get('/deals/pipeline', can(P.DEALS_READ), h(async (req, res) => sendSuccess(res, (await settingsService.get(authOf(req))).dealPipeline)));
r.get('/deals', can(P.DEALS_READ), validate({ query: s.dealListQuery }), h(dealController.list));
r.post('/deals', can(P.DEALS_CREATE), validate({ body: s.dealCreateSchema }), h(dealController.create));
r.get('/deals/:id', can(P.DEALS_READ), id, h(dealController.get));
r.patch('/deals/:id', can(P.DEALS_UPDATE), validate({ params: idParams, body: s.dealUpdateSchema }), h(dealController.update));
r.post('/deals/:id/offers', can(P.DEALS_UPDATE), validate({ params: idParams, body: s.offerSchema }), h(negotiationController.addOffer));
r.post('/deals/:id/offers/:subId/respond', can(P.DEALS_UPDATE), validate({ params: s.subIdParams, body: s.offerRespondSchema }), h(negotiationController.respond));
r.post('/deals/:id/commission/approve', can(P.DEALS_READ, P.COMMISSIONS_MANAGE), id, h(negotiationController.approveCommission));
r.post('/deals/:id/external/:subId/pay', can(P.DEALS_READ, P.COMMISSIONS_MANAGE), validate({ params: s.subIdParams, body: s.externalPaySchema }), h(negotiationController.payExternal));
r.post('/deals/:id/approval', can(P.DEALS_APPROVE), validate({ params: idParams, body: s.dealApprovalSchema }), h(negotiationController.approval));
r.post('/deals/:id/checklist', can(P.DEALS_UPDATE), validate({ params: idParams, body: s.checklistItemSchema }), h(negotiationController.checklist));
r.post('/deals/:id/stage', can(P.DEALS_UPDATE), validate({ params: idParams, body: s.dealStageSchema }), h(dealController.stage));
r.post('/deals/:id/payments', can(P.DEALS_READ, P.COMMISSIONS_MANAGE), validate({ params: idParams, body: s.dealPaymentSchema }), h(dealController.addPayment));
r.delete('/deals/:id/payments/:subId', can(P.DEALS_READ, P.COMMISSIONS_MANAGE), validate({ params: s.subIdParams }), h(dealController.removePayment));
r.post('/deals/:id/payouts', can(P.DEALS_READ, P.COMMISSIONS_MANAGE), validate({ params: idParams, body: s.dealPayoutSchema }), h(dealController.addPayout));
r.post('/deals/:id/payouts/:subId/approve', can(P.DEALS_READ, P.DEALS_APPROVE), validate({ params: s.subIdParams, body: s.noteBodySchema }), h(async (req, res) => sendSuccess(res, await dealService.approvePayout(authOf(req), req.params.id, req.params.subId, req.body.note), { message: 'Payout approved' })));
r.post('/deals/:id/adjustments', can(P.DEALS_READ, P.COMMISSIONS_MANAGE), validate({ params: idParams, body: s.dealAdjustmentSchema }), h(async (req, res) => sendSuccess(res, await dealService.addAdjustment(authOf(req), req.params.id, req.body), { message: 'Commission adjusted' })));
r.post('/deals/:id/dispute', can(P.DEALS_READ, P.COMMISSIONS_MANAGE), validate({ params: idParams, body: s.dealDisputeSchema }), h(async (req, res) => sendSuccess(res, await dealService.setDispute(authOf(req), req.params.id, req.body))));
r.patch('/deals/:id/payouts/:subId', can(P.DEALS_READ, P.COMMISSIONS_MANAGE), validate({ params: s.subIdParams, body: s.dealPayoutUpdateSchema }), h(dealController.updatePayout));
r.delete('/deals/:id', can(P.DEALS_DELETE), id, h(dealController.remove));
// Agreements (signed copies are documents with entityType 'agreement')
r.get('/agreements', can(P.AGREEMENTS_READ), validate({ query: s.agreementListQuery }), h(agreementController.list));
r.post('/agreements', can(P.AGREEMENTS_CREATE), validate({ body: s.agreementCreateSchema }), h(agreementController.create));
r.get('/agreements/:id', can(P.AGREEMENTS_READ), id, h(agreementController.get));
r.patch('/agreements/:id', can(P.AGREEMENTS_UPDATE), validate({ params: idParams, body: s.agreementUpdateSchema }), h(agreementController.update));
r.post('/agreements/:id/render', can(P.AGREEMENTS_UPDATE), validate({ params: idParams, body: s.agreementRenderSchema }), h(agreementController.render));
r.post('/agreements/:id/versions', can(P.AGREEMENTS_UPDATE), validate({ params: idParams, body: s.agreementVersionSchema }), h(agreementController.addVersion));
r.post('/agreements/:id/status', can(P.AGREEMENTS_UPDATE), validate({ params: idParams, body: s.agreementStatusSchema }), h(agreementController.status));
r.get('/agreements/:id/pdf', can(P.AGREEMENTS_READ), validate({ params: idParams, query: s.agreementPdfQuery }), h(agreementController.pdf));
r.delete('/agreements/:id', can(P.AGREEMENTS_DELETE), id, h(agreementController.remove));
r.get('/agreement-templates', can(P.AGREEMENTS_READ), validate({ query: s.agreementTemplateListQuery }), h(agreementController.templates));
r.post('/agreement-templates', can(P.TEMPLATES_MANAGE), validate({ body: s.agreementTemplateCreateSchema }), h(agreementController.createTemplate));
r.patch('/agreement-templates/:id', can(P.TEMPLATES_MANAGE), validate({ params: idParams, body: s.agreementTemplateUpdateSchema }), h(agreementController.updateTemplate));

// Income & expense (receipts are documents with entityType 'transaction')
r.get('/transactions', can(P.FINANCE_READ), validate({ query: s.transactionListQuery }), h(transactionController.list));
r.post('/transactions', can(P.FINANCE_CREATE), validate({ body: s.transactionCreateSchema }), h(transactionController.create));
r.get('/transactions/:id', can(P.FINANCE_READ), id, h(transactionController.get));
r.patch('/transactions/:id', can(P.FINANCE_UPDATE), validate({ params: idParams, body: s.transactionUpdateSchema }), h(transactionController.update));
r.delete('/transactions/:id', can(P.FINANCE_DELETE), id, h(transactionController.remove));
r.get('/transaction-categories', can(P.FINANCE_READ), validate({ query: s.transactionCategoryListQuery }), h(transactionController.categories));
r.post('/transaction-categories', can(P.FINANCE_UPDATE), validate({ body: s.transactionCategoryCreateSchema }), h(transactionController.createCategory));
r.patch('/transaction-categories/:id', can(P.FINANCE_UPDATE), validate({ params: idParams, body: s.transactionCategoryUpdateSchema }), h(transactionController.updateCategory));
r.get('/reports/finance', can(P.FINANCE_READ, P.REPORTS_READ), validate({ query: s.financeReportQuery }), h(transactionController.report));
r.get('/reports/commissions', can(P.DEALS_READ, P.REPORTS_READ), validate({ query: s.commissionReportQuery }), h(dealController.report));

// Owners
r.get('/owners', can(P.OWNERS_READ), validate({ query: s.ownerListQuery }), h(ownerController.list));
r.post('/owners', can(P.OWNERS_CREATE), validate({ body: s.ownerCreateSchema }), h(ownerController.create));
r.get('/owners/:id', can(P.OWNERS_READ), id, h(ownerController.get));
r.patch('/owners/:id', can(P.OWNERS_UPDATE), validate({ params: idParams, body: s.ownerUpdateSchema }), h(ownerController.update));
r.delete('/owners/:id', can(P.OWNERS_DELETE), id, h(ownerController.remove));

// Properties
r.get('/properties', can(P.PROPERTIES_READ), validate({ query: s.propertyListQuery }), h(propertyController.list));
r.get('/properties/import/template', can(P.PROPERTIES_CREATE), h(inventoryToolsController.template));
r.post('/properties/import', can(P.PROPERTIES_CREATE), upload.single('file'), h(inventoryToolsController.importExcel));
r.get('/properties/:id/qr', can(P.PROPERTIES_READ), id, h(inventoryToolsController.qr));
r.get('/properties/:id/verification', can(P.PROPERTIES_READ), id, h(verificationController.get));
r.post('/properties/:id/verification/submit', can(P.VERIFICATION_SUBMIT), validate({ params: idParams, body: s.verificationSubmitSchema }), h(verificationController.submit));
r.post('/properties/:id/verification/assign', can(P.VERIFICATION_SUBMIT), validate({ params: idParams, body: s.verificationAssignSchema }), h(verificationController.assign));
r.post('/properties/:id/verification/checklist', can(P.VERIFICATION_SUBMIT), validate({ params: idParams, body: s.verificationChecklistSchema }), h(verificationController.checklist));
r.post('/properties/:id/verification/decide', can(P.VERIFICATION_DECIDE), validate({ params: idParams, body: s.verificationDecideSchema }), h(verificationController.decide));
r.get('/installments', can(P.FINANCE_READ), validate({ query: s.installmentListQuery }), h(installmentController.list));
r.post('/installments', can(P.FINANCE_CREATE), validate({ body: s.installmentPlanSchema }), h(installmentController.create));
r.get('/installments/:id', can(P.FINANCE_READ), id, h(installmentController.get));
r.post('/installments/:id/payments', can(P.FINANCE_CREATE), validate({ params: idParams, body: s.rentPaymentSchema }), h(installmentController.pay));
r.post('/installments/:id/cancel', can(P.FINANCE_UPDATE), validate({ params: idParams, body: s.installmentCancelSchema }), h(installmentController.cancel));
r.get('/reports/agent-performance', validate({ query: s.performanceQuery }), h(async (req, res) => {
  const q = req.query as unknown as { format?: 'json' | 'xlsx' | 'pdf' } & PeriodFilter;
  const data = await performanceService.agents(authOf(req), q);
  if (!q.format || q.format === 'json') return void sendSuccess(res, data);
  const title = `Agent performance ${data.from.toISOString().slice(0, 10)} – ${data.to.toISOString().slice(0, 10)}`;
  res.setHeader('Content-Disposition', `attachment; filename="agent-performance.${q.format}"`);
  res.setHeader('Content-Type', q.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (q.format === 'pdf') await agentPerformancePdf(data.rows, title, res);
  else await agentPerformanceXlsx(data.rows, title, res);
}));
r.get('/reports/business-summary', can(P.REPORTS_READ), validate({ query: s.performanceQuery }), h(async (req, res) => sendSuccess(res, await performanceService.business(authOf(req), req.query as never))));
r.get('/reports/branches', can(P.REPORTS_READ), validate({ query: s.performanceQuery }), h(async (req, res) => sendSuccess(res, await performanceService.branches(authOf(req), req.query as never))));
r.get('/reports/income-statement', can(P.FINANCE_READ, P.REPORTS_READ), validate({ query: s.periodQuery }), h(financeReportController.incomeStatement));
r.get('/vouchers/:kind/:id', validate({ params: s.voucherParams }), h(financeReportController.voucher));
r.get('/vouchers/:kind/:id/:subId', validate({ params: s.voucherParams }), h(financeReportController.voucher));
r.post('/transactions/:id/refund', can(P.FINANCE_CREATE), validate({ params: idParams, body: s.refundSchema }), h(refundController.refund));
r.get('/reports/cash-flow', can(P.FINANCE_READ, P.REPORTS_READ), validate({ query: s.periodQuery }), h(financeReportController.cashFlow));
r.get('/reports/aging', can(P.FINANCE_READ, P.REPORTS_READ), h(financeReportController.aging));
r.get('/reports/agent-statement', can(P.DEALS_READ), validate({ query: s.agentStatementQuery }), h(financeReportController.agentStatement));
r.get('/receipts/:kind/:id/:paymentId', validate({ params: s.receiptParams }), h(financeReportController.receipt));
r.get('/leases', can(P.RENTALS_READ), validate({ query: s.leaseListQuery }), h(leaseController.list));
r.get('/leases/rent-roll', can(P.RENTALS_READ), h(leaseController.rentRoll));
r.post('/leases', can(P.RENTALS_MANAGE), validate({ body: s.leaseCreateSchema }), h(leaseController.create));
r.get('/leases/:id', can(P.RENTALS_READ), id, h(leaseController.get));
r.post('/leases/:id/payments', can(P.RENTALS_MANAGE), validate({ params: idParams, body: s.rentPaymentSchema }), h(leaseController.pay));
r.post('/leases/:id/waive', can(P.RENTALS_MANAGE), validate({ params: idParams, body: s.rentWaiveSchema }), h(leaseController.waive));
r.post('/leases/:id/notices', can(P.RENTALS_MANAGE), validate({ params: idParams, body: s.tenantNoticeSchema }), h(leaseExtraController.addNotice));
r.get('/leases/:id/notices/:subId/pdf', can(P.RENTALS_READ), validate({ params: s.subIdParams }), h(leaseExtraController.noticePdf));
r.get('/leases/:id/expenses', can(P.RENTALS_READ), id, h(leaseExtraController.expenses));
r.post('/leases/:id/inspections', can(P.RENTALS_MANAGE), validate({ params: idParams, body: s.inspectionSchema }), h(leaseController.inspect));
r.post('/leases/:id/renew', can(P.RENTALS_MANAGE), validate({ params: idParams, body: s.leaseRenewSchema }), h(leaseController.renew));
r.post('/leases/:id/end', can(P.RENTALS_MANAGE), validate({ params: idParams, body: s.leaseEndSchema }), h(leaseController.end));
r.get('/verifications', can(P.PROPERTIES_READ), validate({ query: s.verificationQueueQuery }), h(verificationController.queue));
r.get('/saved-views', validate({ query: s.savedViewQuery }), h(inventoryToolsController.views));
r.post('/saved-views', validate({ body: s.savedViewSchema }), h(inventoryToolsController.createView));
r.delete('/saved-views/:id', id, h(inventoryToolsController.removeView));
r.get('/properties/duplicates', can(P.PROPERTIES_READ), validate({ query: s.duplicatePropertyQuery }), h(propertyController.duplicates));
r.post('/properties', can(P.PROPERTIES_CREATE), validate({ body: s.propertyCreateSchema }), h(propertyController.create));
r.get('/properties/:id', can(P.PROPERTIES_READ), id, h(propertyController.get));
r.get('/properties/:id/brochure', can(P.PROPERTIES_READ, P.EXPORTS_CREATE), validate({ params: idParams, query: s.brochureQuery }), h(propertyController.brochure));
r.patch('/properties/:id', can(P.PROPERTIES_UPDATE), validate({ params: idParams, body: s.propertyUpdateSchema }), h(propertyController.update));
r.post('/properties/:id/verify', can(P.PROPERTIES_UPDATE), validate({ params: idParams, body: s.propertyVerifySchema }), h(propertyController.verify));
r.post('/properties/:id/status', can(P.PROPERTIES_UPDATE), validate({ params: idParams, body: s.propertyStatusSchema }), h(propertyController.changeStatus));
r.delete('/properties/:id', can(P.PROPERTIES_DELETE), id, h(propertyController.remove));
r.get('/properties/:id/matches', can(P.MATCHES_READ), validate({ params: idParams, query: s.matchListQuery }), h(propertyController.matches));
r.get('/properties/:id/media', can(P.PROPERTIES_READ), id, h(propertyController.listMedia));
r.post('/properties/:id/media', can(P.PROPERTIES_UPDATE), id, upload.array('files', 10), h(propertyController.uploadMedia));
r.patch('/media/:id', can(P.PROPERTIES_UPDATE), validate({ params: idParams, body: s.mediaUpdateSchema }), h(mediaController.update));
r.delete('/media/:id', can(P.PROPERTIES_UPDATE), id, h(mediaController.remove));

// Documents
r.get('/documents', can(P.DOCUMENTS_READ), validate({ query: s.documentListQuery }), h(documentController.list));
r.post('/documents', can(P.DOCUMENTS_UPLOAD), upload.single('file'), h(documentController.upload));
r.post('/uploads', can(P.DOCUMENTS_UPLOAD), upload.single('file'), h(documentController.upload));
r.get('/documents/:id/download', can(P.DOCUMENTS_READ), id, h(documentController.download));
r.patch('/documents/:id', can(P.DOCUMENTS_UPLOAD), validate({ params: idParams, body: s.documentUpdateSchema }), h(documentController.update));
r.delete('/documents/:id', can(P.DOCUMENTS_DELETE), id, h(documentController.remove));

// Notes & activity
r.get('/notes', validate({ query: s.noteListQuery }), h(noteController.list));
r.post('/notes', can(P.NOTES_CREATE), validate({ body: s.noteCreateSchema }), h(noteController.create));
r.patch('/notes/:id', can(P.NOTES_CREATE), validate({ params: idParams, body: s.noteUpdateSchema }), h(noteController.update));
r.delete('/notes/:id', can(P.NOTES_CREATE), id, h(noteController.remove));
r.get('/activities', validate({ query: s.activityListQuery }), h(activityController.list));

// Matching
r.get('/matches', can(P.MATCHES_READ), validate({ query: s.matchListQuery }), h(matchController.list));
r.post('/matches/recalculate', can(P.MATCHES_MANAGE), validate({ body: s.recalculateSchema }), h(matchController.recalculate));
r.get('/matches/:id', can(P.MATCHES_READ), id, h(matchController.get));
r.patch('/matches/:id', can(P.MATCHES_MANAGE), validate({ params: idParams, body: s.matchUpdateSchema }), h(matchController.update));
r.get('/settings', h(settingsController.get));
r.patch('/settings', can(P.SETTINGS_MANAGE), validate({ body: s.settingsUpdateSchema }), h(settingsController.update));

// Follow-ups
r.get('/followups', can(P.FOLLOWUPS_READ), validate({ query: s.followUpListQuery }), h(followUpController.list));
r.post('/followups', can(P.FOLLOWUPS_CREATE), validate({ body: s.followUpCreateSchema }), h(followUpController.create));
r.get('/followups/:id', can(P.FOLLOWUPS_READ), id, h(followUpController.get));
r.patch('/followups/:id', can(P.FOLLOWUPS_UPDATE), validate({ params: idParams, body: s.followUpUpdateSchema }), h(followUpController.update));
r.post('/followups/:id/complete', can(P.FOLLOWUPS_UPDATE), validate({ params: idParams, body: s.followUpCompleteSchema }), h(followUpController.complete));
r.delete('/followups/:id', can(P.FOLLOWUPS_DELETE), id, h(followUpController.remove));

// Notifications & devices
r.get('/notifications', validate({ query: s.notificationListQuery }), h(notificationController.list));
r.post('/notifications/read-all', validate({ body: s.markAllReadSchema }), h(notificationController.readAll));
r.post('/notifications/:id/read', id, h(notificationController.read));
r.post('/devices', validate({ body: s.deviceSchema }), h(notificationController.registerDevice));
r.delete('/devices/:token', h(notificationController.unregisterDevice));

// Exports
r.get('/exports/:resource', can(P.EXPORTS_CREATE), validate({ params: s.exportParams, query: s.exportQuery }), h(exportController.download));

// Offline sync
r.post('/sync/push', validate({ body: s.syncPushSchema }), h(syncController.push));
r.get('/sync/pull', validate({ query: s.syncPullQuery }), h(syncController.pull));
r.get('/sync/bootstrap', h(syncController.bootstrap));

export default r;
