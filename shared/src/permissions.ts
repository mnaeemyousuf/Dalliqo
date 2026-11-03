/**
 * Permission catalogue. Permissions are the unit of authorization; roles are
 * just named presets of permissions. The API is the only place permissions are
 * enforced — clients use this list purely to hide controls the user can't use.
 */
export const PERMISSIONS = {
  CLIENTS_READ: 'clients:read',
  CLIENTS_CREATE: 'clients:create',
  CLIENTS_UPDATE: 'clients:update',
  CLIENTS_DELETE: 'clients:delete',

  PROPERTIES_READ: 'properties:read',
  PROPERTIES_CREATE: 'properties:create',
  PROPERTIES_UPDATE: 'properties:update',
  PROPERTIES_DELETE: 'properties:delete',

  OWNERS_READ: 'owners:read',
  OWNERS_CREATE: 'owners:create',
  OWNERS_UPDATE: 'owners:update',
  OWNERS_DELETE: 'owners:delete',

  MATCHES_READ: 'matches:read',
  MATCHES_MANAGE: 'matches:manage',

  FOLLOWUPS_READ: 'followups:read',
  FOLLOWUPS_CREATE: 'followups:create',
  FOLLOWUPS_UPDATE: 'followups:update',
  FOLLOWUPS_DELETE: 'followups:delete',

  NOTES_CREATE: 'notes:create',
  NOTES_MANAGE_ALL: 'notes:manage_all',

  DOCUMENTS_READ: 'documents:read',
  DOCUMENTS_UPLOAD: 'documents:upload',
  DOCUMENTS_DELETE: 'documents:delete',

  /** Deals the user is an agent on. */
  DEALS_READ: 'deals:read',
  /** Every deal (not only the user's own) and all commission figures. */
  DEALS_READ_ALL: 'deals:read_all',
  DEALS_CREATE: 'deals:create',
  DEALS_UPDATE: 'deals:update',
  DEALS_DELETE: 'deals:delete',
  /** Record commission payments received and agent payouts. */
  COMMISSIONS_MANAGE: 'commissions:manage',

  /** Income & expense entries and the finance report. */
  FINANCE_READ: 'finance:read',
  FINANCE_CREATE: 'finance:create',
  /** Edit entries and manage the categories. */
  FINANCE_UPDATE: 'finance:update',
  FINANCE_DELETE: 'finance:delete',

  REPORTS_READ: 'reports:read',
  EXPORTS_CREATE: 'exports:create',

  MEMBERS_READ: 'members:read',
  MEMBERS_MANAGE: 'members:manage',

  /** Create, rename and archive branches. Which branches a member can SEE is set on the membership. */
  BRANCHES_MANAGE: 'branches:manage',

  BUSINESS_MANAGE: 'business:manage',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_READ: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(Object.values(PERMISSIONS));

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/** Grouping used by permission editors in the web and mobile UIs. */
export const PERMISSION_GROUPS: Record<string, readonly Permission[]> = {
  clients: [PERMISSIONS.CLIENTS_READ, PERMISSIONS.CLIENTS_CREATE, PERMISSIONS.CLIENTS_UPDATE, PERMISSIONS.CLIENTS_DELETE],
  properties: [
    PERMISSIONS.PROPERTIES_READ,
    PERMISSIONS.PROPERTIES_CREATE,
    PERMISSIONS.PROPERTIES_UPDATE,
    PERMISSIONS.PROPERTIES_DELETE,
  ],
  owners: [PERMISSIONS.OWNERS_READ, PERMISSIONS.OWNERS_CREATE, PERMISSIONS.OWNERS_UPDATE, PERMISSIONS.OWNERS_DELETE],
  matches: [PERMISSIONS.MATCHES_READ, PERMISSIONS.MATCHES_MANAGE],
  followups: [
    PERMISSIONS.FOLLOWUPS_READ,
    PERMISSIONS.FOLLOWUPS_CREATE,
    PERMISSIONS.FOLLOWUPS_UPDATE,
    PERMISSIONS.FOLLOWUPS_DELETE,
  ],
  notes: [PERMISSIONS.NOTES_CREATE, PERMISSIONS.NOTES_MANAGE_ALL],
  documents: [PERMISSIONS.DOCUMENTS_READ, PERMISSIONS.DOCUMENTS_UPLOAD, PERMISSIONS.DOCUMENTS_DELETE],
  deals: [
    PERMISSIONS.DEALS_READ,
    PERMISSIONS.DEALS_READ_ALL,
    PERMISSIONS.DEALS_CREATE,
    PERMISSIONS.DEALS_UPDATE,
    PERMISSIONS.DEALS_DELETE,
    PERMISSIONS.COMMISSIONS_MANAGE,
  ],
  finance: [PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_CREATE, PERMISSIONS.FINANCE_UPDATE, PERMISSIONS.FINANCE_DELETE],
  reports: [PERMISSIONS.REPORTS_READ, PERMISSIONS.EXPORTS_CREATE],
  administration: [
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.MEMBERS_MANAGE,
    PERMISSIONS.BRANCHES_MANAGE,
    PERMISSIONS.BUSINESS_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.AUDIT_READ,
  ],
};
