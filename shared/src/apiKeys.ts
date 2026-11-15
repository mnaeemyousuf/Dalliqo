/**
 * API access (Enterprise). A key acts on behalf of the member who created it, with a subset of
 * that member's permissions, and only on record endpoints — never on members, settings, billing
 * or sign-in. Keys are shown once; only a hash is stored.
 */
import { PERMISSIONS, type Permission } from './permissions';

export const API_KEY_PREFIX = 'dq_live_';

/** Permissions a key may carry (the creator must hold them too). */
export const API_KEY_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.CLIENTS_READ,
  PERMISSIONS.CLIENTS_CREATE,
  PERMISSIONS.CLIENTS_UPDATE,
  PERMISSIONS.PROPERTIES_READ,
  PERMISSIONS.PROPERTIES_CREATE,
  PERMISSIONS.PROPERTIES_UPDATE,
  PERMISSIONS.OWNERS_READ,
  PERMISSIONS.OWNERS_CREATE,
  PERMISSIONS.OWNERS_UPDATE,
  PERMISSIONS.MATCHES_READ,
  PERMISSIONS.FOLLOWUPS_READ,
  PERMISSIONS.FOLLOWUPS_CREATE,
  PERMISSIONS.FOLLOWUPS_UPDATE,
  PERMISSIONS.NOTES_CREATE,
  PERMISSIONS.DEALS_READ,
  PERMISSIONS.DEALS_READ_ALL,
  PERMISSIONS.DEALS_CREATE,
  PERMISSIONS.DEALS_UPDATE,
  PERMISSIONS.FINANCE_READ,
  PERMISSIONS.RENTALS_READ,
  PERMISSIONS.REPORTS_READ,
];

/** URL prefixes (after /api) a key may call. */
export const API_KEY_PATHS: readonly string[] = [
  '/clients', '/client-categories', '/owners', '/properties', '/matches', '/followups', '/notes', '/deals', '/branches',
  '/transactions', '/transaction-categories', '/leases', '/installments', '/inquiries', '/reports', '/search', '/dashboard',
];

export const MAX_API_KEYS = 10;
