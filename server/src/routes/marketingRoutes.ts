import { Router, type Request, type Response } from 'express';
import { PassThrough } from 'node:stream';
import { PERMISSIONS as P } from '@recrm/shared';
import { authOf } from '../middleware/authenticate';
import { requirePermission as can } from '../middleware/authorize';
import { inquiryLimiter } from '../middleware/rateLimiters';
import { validate } from '../middleware/validate';
import { campaignService } from '../services/campaignService';
import { portalService } from '../services/portalService';
import { websiteService } from '../services/websiteService';
import { whatsappService } from '../services/whatsappService';
import { forbidden } from '../utils/AppError';
import { asyncHandler as h, pageMeta, sendSuccess } from '../utils/http';
import { idParams } from '../validators/common';
import * as s from '../validators/marketing.schemas';

type Paged = { page: number; limit: number };
const q = <T>(req: Request) => req.query as unknown as T & Paged;
const paged = <T>(res: Response, page: number, limit: number, r: { items: T[]; total: number }) => sendSuccess(res, r.items, { meta: pageMeta(page, limit, r.total) });
const id = validate({ params: idParams });

/** Signed-in routes: website settings, inquiries, campaigns, portal links, WhatsApp. */
export const marketingRoutes = Router();
const r = marketingRoutes;

r.get('/website', can(P.CLIENTS_READ), h(async (req, res) => sendSuccess(res, await websiteService.getSettings(authOf(req)))));
r.put('/website', can(P.MARKETING_MANAGE), validate({ body: s.websiteSettingsSchema }), h(async (req, res) => sendSuccess(res, await websiteService.updateSettings(authOf(req), req.body), { message: 'Website settings saved' })));
r.post('/properties/:id/publish', can(P.PROPERTIES_UPDATE), validate({ params: idParams, body: s.publishSchema }), h(async (req, res) => sendSuccess(res, await websiteService.publish(authOf(req), req.params.id, req.body))));

r.get('/inquiries', can(P.CLIENTS_READ), validate({ query: s.inquiryListQuery }), h(async (req, res) => {
  const x = q<Record<string, never>>(req);
  paged(res, x.page, x.limit, await websiteService.listInquiries(authOf(req), x));
}));
r.patch('/inquiries/:id', can(P.CLIENTS_UPDATE), validate({ params: idParams, body: s.inquiryStatusSchema }), h(async (req, res) => sendSuccess(res, await websiteService.setInquiryStatus(authOf(req), req.params.id, req.body.status))));

r.get('/campaigns', can(P.CLIENTS_READ), validate({ query: s.campaignListQuery }), h(async (req, res) => {
  const x = q<Record<string, never>>(req);
  paged(res, x.page, x.limit, await campaignService.list(authOf(req), x));
}));
r.post('/campaigns', can(P.MARKETING_MANAGE), validate({ body: s.campaignCreateSchema }), h(async (req, res) => sendSuccess(res, await campaignService.create(authOf(req), req.body), { status: 201, message: 'Campaign created' })));
r.get('/campaigns/:id', can(P.CLIENTS_READ), id, h(async (req, res) => sendSuccess(res, await campaignService.get(authOf(req), req.params.id))));
r.patch('/campaigns/:id', can(P.MARKETING_MANAGE), validate({ params: idParams, body: s.campaignUpdateSchema }), h(async (req, res) => sendSuccess(res, await campaignService.update(authOf(req), req.params.id, req.body))));
r.delete('/campaigns/:id', can(P.MARKETING_MANAGE), id, h(async (req, res) => {
  await campaignService.remove(authOf(req), req.params.id);
  sendSuccess(res, null, { message: 'Campaign deleted' });
}));
r.get('/reports/campaigns', can(P.REPORTS_READ), h(async (req, res) => sendSuccess(res, await campaignService.report(authOf(req)))));

r.get('/portal-settings', can(P.CLIENTS_READ), h(async (req, res) => sendSuccess(res, await portalService.getSettings(authOf(req)))));
r.put('/portal-settings', can(P.MARKETING_MANAGE), validate({ body: s.portalSettingsSchema }), h(async (req, res) => sendSuccess(res, await portalService.updateSettings(authOf(req), req.body), { message: 'Portal settings saved' })));
r.post('/portal-links', validate({ body: s.portalLinkSchema }), h(async (req, res) => sendSuccess(res, await portalService.createLink(authOf(req), req.body), { status: 201 })));
r.get('/portal-links', validate({ query: s.portalLinkListQuery }), h(async (req, res) => {
  const a = authOf(req);
  const x = req.query as unknown as { kind: 'CLIENT' | 'OWNER'; partyId: string };
  if (!a.permissions.includes(x.kind === 'CLIENT' ? P.CLIENTS_READ : P.OWNERS_READ)) throw forbidden();
  sendSuccess(res, await portalService.listLinks(a, x.kind, x.partyId));
}));
r.delete('/portal-links/:id', can(P.CLIENTS_UPDATE), id, h(async (req, res) => sendSuccess(res, await portalService.revoke(authOf(req), req.params.id))));

r.get('/whatsapp', can(P.CLIENTS_READ), h(async (req, res) => sendSuccess(res, await whatsappService.status(authOf(req)))));
r.put('/whatsapp', can(P.MARKETING_MANAGE), validate({ body: s.whatsappSettingsSchema }), h(async (req, res) => sendSuccess(res, await whatsappService.updateSettings(authOf(req), req.body))));
r.post('/whatsapp/templates/sync', can(P.MARKETING_MANAGE), h(async (req, res) => sendSuccess(res, await whatsappService.syncTemplates(authOf(req)), { message: 'Templates updated' })));
r.post('/whatsapp/send', can(P.CLIENTS_UPDATE), validate({ body: s.whatsappSendSchema }), h(async (req, res) => sendSuccess(res, await whatsappService.send(authOf(req), req.body))));

/** Public routes (no sign-in): the agency website, inquiries, portals and the WhatsApp webhook. */
export const publicRoutes = Router();
const pr = publicRoutes;

pr.get('/sites/:slug', validate({ params: s.slugParams }), h(async (req, res) => sendSuccess(res, await websiteService.site(req.params.slug))));
pr.get('/sites/:slug/listings', validate({ params: s.slugParams, query: s.publicListingQuery }), h(async (req, res) => {
  const x = q<Record<string, never>>(req);
  paged(res, x.page, x.limit, await websiteService.listings(req.params.slug, x));
}));
pr.get('/sites/:slug/agents/:id', validate({ params: s.slugIdParams }), h(async (req, res) => sendSuccess(res, await websiteService.agent(req.params.slug, req.params.id))));
pr.get('/sites/:slug/listings/:id', validate({ params: s.slugIdParams }), h(async (req, res) => sendSuccess(res, await websiteService.listing(req.params.slug, req.params.id))));
pr.post('/sites/:slug/inquiries', inquiryLimiter, validate({ params: s.slugParams, body: s.publicInquirySchema }), h(async (req, res) => sendSuccess(res, await websiteService.inquire(req.params.slug, req.body, req.ip), { status: 201, message: 'Thank you — we will contact you shortly' })));

pr.get('/portal/:token', validate({ params: s.tokenParams }), h(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  sendSuccess(res, await portalService.view(req.params.token));
}));
pr.get('/portal/:token/receipts/:kind/:id/:paymentId', validate({ params: s.portalReceiptParams }), h(async (req, res) => {
  const { token, kind, id: rid, paymentId } = req.params as { token: string; kind: 'lease' | 'installment' | 'deal'; id: string; paymentId: string };
  const buf = new PassThrough();
  const chunks: Buffer[] = [];
  buf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((ok) => buf.on('end', () => ok()));
  await portalService.receipt(token, kind, rid, paymentId, buf);
  await done;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${paymentId.slice(0, 8)}.pdf"`);
  res.end(Buffer.concat(chunks));
}));
pr.patch('/portal/:token/preferences', inquiryLimiter, validate({ params: s.tokenParams, body: s.portalPreferencesSchema }), h(async (req, res) => sendSuccess(res, await portalService.updatePreferences(req.params.token, req.body), { message: 'Preferences updated' })));
pr.post('/portal/:token/matches/:matchId', validate({ params: s.portalMatchParams, body: s.portalReactionSchema }), h(async (req, res) => sendSuccess(res, await portalService.reactToMatch(req.params.token, req.params.matchId, req.body.reaction))));
pr.post('/portal/:token/visits', inquiryLimiter, validate({ params: s.tokenParams, body: s.portalVisitSchema }), h(async (req, res) => sendSuccess(res, await portalService.requestVisit(req.params.token, req.body), { status: 201, message: 'Visit requested' })));
pr.post('/portal/:token/properties/:propertyId/availability', inquiryLimiter, validate({ params: s.portalPropertyParams, body: s.portalAvailabilitySchema }), h(async (req, res) => sendSuccess(res, await portalService.ownerAvailability(req.params.token, req.params.propertyId, req.body), { message: 'Thank you — your agent has been told' })));
pr.get('/portal/:token/documents/:docId', validate({ params: s.portalDocParams }), h(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendSuccess(res, await portalService.document(req.params.token, req.params.docId));
}));
pr.post('/portal/:token/requests', inquiryLimiter, validate({ params: s.tokenParams, body: s.portalRequestSchema }), h(async (req, res) => sendSuccess(res, await portalService.request(req.params.token, req.body.message), { status: 201, message: 'Message sent' })));

pr.get('/whatsapp/webhook', (req, res) => {
  const challenge = whatsappService.verify(req.query as Record<string, unknown>);
  if (challenge === null) return void res.sendStatus(403);
  res.type('text/plain').send(challenge);
});
pr.post('/whatsapp/webhook', h(async (req, res) => {
  if (!whatsappService.signatureValid((req as unknown as { rawBody?: Buffer }).rawBody, req.get('x-hub-signature-256'))) return void res.sendStatus(401);
  // Meta expects a fast 200; processing failures are logged per message, never retried forever.
  await whatsappService.inbound(req.body);
  res.sendStatus(200);
}));
