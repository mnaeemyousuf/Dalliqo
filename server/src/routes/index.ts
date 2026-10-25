import { Router } from 'express';
import { PERMISSIONS } from '@recrm/shared';
import { isDatabaseReady } from '../config/database';
import { auditController } from '../controllers/auditController';
import { metaController } from '../controllers/metaController';
import { authenticate, requirePasswordCurrent } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/http';
import { listAuditQuery } from '../validators/audit.schemas';
import authRoutes from './authRoutes';
import businessRoutes from './businessRoutes';
import memberRoutes from './memberRoutes';
import crmRoutes from './crmRoutes';
import fileRoutes from './fileRoutes';

const api = Router();

api.get('/health', (_req, res) => {
  const db = isDatabaseReady();
  res.status(db ? 200 : 503).json({ success: db, data: { status: db ? 'ok' : 'degraded', database: db ? 'up' : 'down' } });
});

api.use('/auth', authRoutes);
// Signed / unguessable links to locally stored files (local storage driver only).
api.use('/files', fileRoutes);

// Everything below requires a signed-in user with a non-temporary password.
// Each router enforces its own permissions; tenant scoping happens in repositories.
// Mounted per path so unknown routes still fall through to a 404.
const secured = [authenticate, requirePasswordCurrent];
api.use('/business', ...secured, businessRoutes);
api.use('/members', ...secured, memberRoutes);
api.get('/audit-logs', ...secured, requirePermission(PERMISSIONS.AUDIT_READ), validate({ query: listAuditQuery }), asyncHandler(auditController.list));
api.get('/meta/permissions', ...secured, metaController.permissions);

// CRM modules. Auth runs only for these prefixes so unknown paths still 404.
const CRM_PREFIXES = [
  '/dashboard', '/my-day', '/search', '/client-categories', '/clients', '/owners', '/properties', '/media',
  '/documents', '/uploads', '/notes', '/activities', '/matches', '/settings', '/followups', '/notifications',
  '/devices', '/exports', '/sync',
];
api.use(CRM_PREFIXES, ...secured);
api.use(crmRoutes);

export default api;
