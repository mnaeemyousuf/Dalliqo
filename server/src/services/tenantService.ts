import { Types } from 'mongoose';
import { ERROR_CODES } from '@recrm/shared';
import { env } from '../config/env';
import { Business } from '../models/Business';
import { badRequest, conflict } from '../utils/AppError';

/**
 * SaaS addresses. With TENANT_BASE_DOMAIN set (e.g. "stateown.pk"), each agency works at
 * https://<subdomain>.stateown.pk. The bare domain, www and the names below stay with the shared
 * application (sign-up, the phone app's API, platform administration).
 */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'app', 'admin', 'administrator', 'platform', 'portal', 'static', 'assets', 'cdn', 'media', 'files',
  'mail', 'email', 'smtp', 'imap', 'pop', 'webmail', 'ftp', 'cpanel', 'hpanel', 'whm', 'ns1', 'ns2', 'dns',
  'support', 'help', 'docs', 'blog', 'status', 'billing', 'account', 'accounts', 'login', 'signup', 'register',
  'dev', 'test', 'staging', 'demo', 'beta', 'stateown', 'root', 'system', 'internal', 'socket',
]);

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export interface Tenant {
  businessId: string;
  name: string;
  subdomain: string;
}

/** "Yousuf Estate & Builders" → "yousuf-estate-builders" (3–30 characters, letters, digits and dashes). */
export function slugifySubdomain(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  return s.length >= 3 ? s : `agency-${s || 'new'}`.slice(0, 30);
}

export function subdomainProblem(sub: string): string | null {
  if (!SUBDOMAIN.test(sub)) return 'Use 3–30 lowercase letters, digits or dashes (not at the start or end)';
  if (sub.includes('--')) return 'Do not use two dashes in a row';
  if (RESERVED_SUBDOMAINS.has(sub)) return 'This address is reserved';
  return null;
}

const TTL_MS = 60_000;
const cache = new Map<string, { tenant: Tenant | null; at: number }>();

export const tenantService = {
  /** True when the system is sold per subdomain. */
  enabled(): boolean {
    return !!env.TENANT_BASE_DOMAIN;
  },

  /**
   * The subdomain a request's Host names, or null for the shared address (bare domain, www,
   * reserved names, other hosts such as localhost or an IP).
   */
  subdomainOf(host: string | undefined): string | null {
    const base = env.TENANT_BASE_DOMAIN;
    if (!base || !host) return null;
    const h = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    if (!h.endsWith(`.${base}`)) return null;
    const sub = h.slice(0, -(base.length + 1));
    if (!sub || sub.includes('.') || RESERVED_SUBDOMAINS.has(sub)) return null;
    return sub;
  },

  /** The agency at this subdomain (cached briefly), or null if none. */
  async bySubdomain(sub: string): Promise<Tenant | null> {
    const hit = cache.get(sub);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.tenant;
    const b = await Business.findOne({ subdomain: sub, status: { $ne: 'DISABLED' } }).select('name subdomain').lean<{ _id: Types.ObjectId; name: string; subdomain: string }>();
    const tenant = b ? { businessId: String(b._id), name: b.name, subdomain: b.subdomain } : null;
    cache.set(sub, { tenant, at: Date.now() });
    return tenant;
  },

  forget(sub?: string | null): void {
    if (sub) cache.delete(sub);
    else cache.clear();
  },

  /** The web address of an agency (its subdomain when subdomains are on, else the shared address). */
  urlFor(business: { subdomain?: string | null } | null | undefined): string {
    const shared = env.APP_WEB_URL.replace(/\/$/, '');
    if (!env.TENANT_BASE_DOMAIN || !business?.subdomain) return shared;
    const proto = new URL(shared).protocol;
    return `${proto}//${business.subdomain}.${env.TENANT_BASE_DOMAIN}`;
  },

  /** Address of a business by id (for e-mails and links made outside a request). */
  async urlForBusiness(businessId: string | Types.ObjectId | null | undefined): Promise<string> {
    if (!businessId || !env.TENANT_BASE_DOMAIN) return this.urlFor(null);
    const b = await Business.findById(businessId).select('subdomain').lean<{ subdomain?: string | null }>();
    return this.urlFor(b);
  },

  /** A free subdomain for a new agency: the requested one (checked) or one made from the name. */
  async claim(requested: string | undefined, name: string, exceptBusinessId?: Types.ObjectId): Promise<string> {
    if (requested) {
      const sub = requested.trim().toLowerCase();
      const problem = subdomainProblem(sub);
      if (problem) throw badRequest(ERROR_CODES.VALIDATION_ERROR, problem, [{ path: 'subdomain', message: problem }]);
      const taken = await Business.exists({ subdomain: sub, ...(exceptBusinessId ? { _id: { $ne: exceptBusinessId } } : {}) });
      if (taken) throw conflict(ERROR_CODES.SUBDOMAIN_TAKEN, 'This address is already taken', [{ path: 'subdomain', message: 'This address is already taken' }]);
      return sub;
    }
    const base = slugifySubdomain(name);
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base.slice(0, 26)}-${i + 1}`;
      if (!subdomainProblem(candidate) && !(await Business.exists({ subdomain: candidate }))) return candidate;
    }
    return `${base.slice(0, 21)}-${new Types.ObjectId().toString().slice(-8)}`;
  },

  /** Origin check for CORS: any agency subdomain of the base domain (same scheme as APP_WEB_URL). */
  isTenantOrigin(origin: string): boolean {
    const base = env.TENANT_BASE_DOMAIN;
    if (!base) return false;
    try {
      const u = new URL(origin);
      const proto = new URL(env.APP_WEB_URL).protocol;
      return u.protocol === proto && !u.port && (u.hostname === base || u.hostname.endsWith(`.${base}`));
    } catch {
      return false;
    }
  },
};
