import { Router } from 'express';
import multer from 'multer';
import { PERMISSIONS as P } from '@recrm/shared';
import { env } from '../config/env';
import {
  activityController,
  categoryController,
  clientController,
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
r.get('/dashboard/analytics', can(P.REPORTS_READ), validate({ query: s.analyticsQuery }), h(dashboardController.analytics));
r.get('/my-day', validate({ query: s.myDayQuery }), h(dashboardController.myDay));
r.get('/search', validate({ query: s.searchQuery }), h(dashboardController.search));

// Client categories
r.get('/client-categories', can(P.CLIENTS_READ), validate({ query: s.categoryListQuery }), h(categoryController.list));
r.post('/client-categories', can(P.SETTINGS_MANAGE), validate({ body: s.categoryCreateSchema }), h(categoryController.create));
r.patch('/client-categories/:id', can(P.SETTINGS_MANAGE), validate({ params: idParams, body: s.categoryUpdateSchema }), h(categoryController.update));

// Clients
r.get('/clients', can(P.CLIENTS_READ), validate({ query: s.clientListQuery }), h(clientController.list));
r.post('/clients', can(P.CLIENTS_CREATE), validate({ body: s.clientCreateSchema }), h(clientController.create));
r.get('/clients/duplicates', can(P.CLIENTS_READ), validate({ query: s.duplicateClientQuery }), h(clientController.duplicates));
r.get('/clients/:id', can(P.CLIENTS_READ), id, h(clientController.get));
r.patch('/clients/:id', can(P.CLIENTS_UPDATE), validate({ params: idParams, body: s.clientUpdateSchema }), h(clientController.update));
r.delete('/clients/:id', can(P.CLIENTS_DELETE), id, h(clientController.remove));
r.post('/clients/:id/communications', can(P.CLIENTS_READ), validate({ params: idParams, body: s.communicationSchema }), h(clientController.communicate));
r.get('/clients/:id/matches', can(P.MATCHES_READ), validate({ params: idParams, query: s.matchListQuery }), h(clientController.matches));

// Owners
r.get('/owners', can(P.OWNERS_READ), validate({ query: s.ownerListQuery }), h(ownerController.list));
r.post('/owners', can(P.OWNERS_CREATE), validate({ body: s.ownerCreateSchema }), h(ownerController.create));
r.get('/owners/:id', can(P.OWNERS_READ), id, h(ownerController.get));
r.patch('/owners/:id', can(P.OWNERS_UPDATE), validate({ params: idParams, body: s.ownerUpdateSchema }), h(ownerController.update));
r.delete('/owners/:id', can(P.OWNERS_DELETE), id, h(ownerController.remove));

// Properties
r.get('/properties', can(P.PROPERTIES_READ), validate({ query: s.propertyListQuery }), h(propertyController.list));
r.post('/properties', can(P.PROPERTIES_CREATE), validate({ body: s.propertyCreateSchema }), h(propertyController.create));
r.get('/properties/:id', can(P.PROPERTIES_READ), id, h(propertyController.get));
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
