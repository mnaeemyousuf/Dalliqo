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
import { platformRoutes, subscriptionRoutes } from './subscriptionRoutes';
import { entitlementGuard, requireModule } from '../middleware/entitlements';
import { apiKeyRoutes } from './apiKeyRoutes';
import { marketingRoutes, publicRoutes } from './marketingRoutes';
import { aiRoutes } from './aiRoutes';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { runDueJobs } from '../jobs/scheduler';
import { tenantService } from '../services/tenantService';

const api = Router();

api.get('/health', (_req, res) => {
  const db = isDatabaseReady();
  res.status(db ? 200 : 503).json({ success: db, data: { status: db ? 'ok' : 'degraded', database: db ? 'up' : 'down' } });
});

// Which agency this address belongs to (sign-in page branding, "agency not found").
api.get('/public/tenant', (req, res) => {
  const sub = tenantService.subdomainOf(req.hostname);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: {
      baseDomain: env.TENANT_BASE_DOMAIN ?? null,
      subdomain: sub,
      tenant: req.tenant ? { name: req.tenant.name, subdomain: req.tenant.subdomain, url: tenantService.urlFor(req.tenant) } : null,
    },
  });
});

// Hosts without always-on timers (Hostinger web hosting): a cron job calls this every minute.
api.post('/internal/jobs', async (req, res, next) => {
  try {
    const given = Buffer.from(String(req.get('x-cron-secret') ?? ''));
    const secret = Buffer.from(env.CRON_SECRET ?? '');
    if (!env.CRON_SECRET || given.length !== secret.length || !timingSafeEqual(given, secret)) {
      res.status(404).json({ success: false, code: 'ROUTE_NOT_FOUND', message: 'Not found' });
      return;
    }
    res.json({ success: true, data: await runDueJobs() });
  } catch (err) {
    next(err);
  }
});

api.use('/auth', authRoutes);
// Signed / unguessable links to locally stored files (local storage driver only).
api.use('/files', fileRoutes);
// Agency websites, portals and provider webhooks (no sign-in; each route checks its own token / slug).
api.use('/public', publicRoutes);

// Everything below requires a signed-in user with a non-temporary password.
// Each router enforces its own permissions; tenant scoping happens in repositories.
// Mounted per path so unknown routes still fall through to a 404.
const secured = [authenticate, requirePasswordCurrent];
api.use('/business', ...secured, businessRoutes);
api.use('/members', ...secured, entitlementGuard, memberRoutes);
api.use('/subscription', ...secured, subscriptionRoutes);
api.use('/platform', ...secured, platformRoutes);
api.use('/api-keys', ...secured, requireModule('api'), requirePermission(PERMISSIONS.SETTINGS_MANAGE), apiKeyRoutes);
api.get('/audit-logs', ...secured, requirePermission(PERMISSIONS.AUDIT_READ), validate({ query: listAuditQuery }), asyncHandler(auditController.list));
api.get('/meta/permissions', ...secured, metaController.permissions);

// CRM modules. Auth runs only for these prefixes so unknown paths still 404.
const CRM_PREFIXES = [
  '/dashboard', '/my-day', '/search', '/branches', '/client-categories', '/clients', '/owners', '/properties', '/media',
  '/documents', '/uploads', '/notes', '/activities', '/matches', '/settings', '/followups', '/notifications',
  '/devices', '/exports', '/sync', '/deals', '/reports', '/transactions', '/transaction-categories', '/agreements', '/agreement-templates',
  '/verifications', '/saved-views', '/leases', '/installments', '/receipts',
  '/website', '/inquiries', '/campaigns', '/portal-links', '/portal-settings', '/whatsapp', '/ai', '/vouchers',
];
api.use(CRM_PREFIXES, ...secured, entitlementGuard);
api.use(marketingRoutes);
api.use(aiRoutes);
api.use(crmRoutes);

export default api;
