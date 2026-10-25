import type { Request, Response } from 'express';
import { authOf } from '../middleware/authenticate';
import { activityService } from '../services/activityService';
import { categoryService } from '../services/categoryService';
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
import { clientRepository, propertyRepository } from '../repositories/entityRepositories';
import { clientListQuery, documentUploadFields, followUpListQuery, matchListQuery, ownerListQuery, propertyListQuery } from '../validators/crm.schemas';
import type { ZodTypeAny } from 'zod';

const EXPORT_FILTERS: Record<ExportResource, ZodTypeAny> = {
  clients: clientListQuery,
  properties: propertyListQuery,
  owners: ownerListQuery,
  followups: followUpListQuery,
  matches: matchListQuery,
};
import { forbidden } from '../utils/AppError';
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
    list(res, q.page, q.limit, await ownerService.list(authOf(req), q));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await ownerService.get(authOf(req), req.params.id));
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
  async list(req: Request, res: Response) {
    const q = query<Q>(req);
    list(res, q.page, q.limit, await propertyService.list(authOf(req), q));
  },
  async get(req: Request, res: Response) {
    sendSuccess(res, await propertyService.get(authOf(req), req.params.id));
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

const NOTE_READ: Record<string, string> = { client: 'clients:read', property: 'properties:read', owner: 'owners:read', followUp: 'followups:read' };

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
    sendSuccess(res, await dashboardService.summary(authOf(req)));
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
