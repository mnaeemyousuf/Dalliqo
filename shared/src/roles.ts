import { ALL_PERMISSIONS, PERMISSIONS, type Permission, isPermission } from './permissions';

export const ROLES = {
  OWNER: 'OWNER',
  MEMBER: 'MEMBER',
  // Future roles. Their presets exist so the permission model is proven to
  // support them, but they are not assignable until the product enables them.
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  AGENT: 'AGENT',
  SALESPERSON: 'SALESPERSON',
  ACCOUNTANT: 'ACCOUNTANT',
  VIEWER: 'VIEWER',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: readonly Role[] = Object.freeze(Object.values(ROLES));

/** Roles an owner can assign to a member in the current release. */
export const ASSIGNABLE_ROLES: readonly Role[] = Object.freeze([ROLES.MEMBER]);

const P = PERMISSIONS;

const READ_ALL: Permission[] = [
  P.CLIENTS_READ,
  P.PROPERTIES_READ,
  P.OWNERS_READ,
  P.MATCHES_READ,
  P.FOLLOWUPS_READ,
  P.DOCUMENTS_READ,
];

const WORK_ALL: Permission[] = [
  ...READ_ALL,
  P.CLIENTS_CREATE,
  P.CLIENTS_UPDATE,
  P.PROPERTIES_CREATE,
  P.PROPERTIES_UPDATE,
  P.OWNERS_CREATE,
  P.OWNERS_UPDATE,
  P.MATCHES_MANAGE,
  P.FOLLOWUPS_CREATE,
  P.FOLLOWUPS_UPDATE,
  P.FOLLOWUPS_DELETE,
  P.NOTES_CREATE,
  P.DOCUMENTS_UPLOAD,
];

/** Default permissions granted when a member is created with a given role. */
export const ROLE_PRESETS: Record<Role, readonly Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  // The family-business default: the second user can do all day-to-day work
  // but cannot delete core records or administer the account.
  MEMBER: [...WORK_ALL, P.REPORTS_READ, P.EXPORTS_CREATE, P.MEMBERS_READ],
  ADMIN: ALL_PERMISSIONS.filter((p) => p !== P.BUSINESS_MANAGE),
  MANAGER: [
    ...WORK_ALL,
    P.CLIENTS_DELETE,
    P.PROPERTIES_DELETE,
    P.OWNERS_DELETE,
    P.DOCUMENTS_DELETE,
    P.NOTES_MANAGE_ALL,
    P.REPORTS_READ,
    P.EXPORTS_CREATE,
    P.MEMBERS_READ,
    P.AUDIT_READ,
  ],
  AGENT: WORK_ALL,
  SALESPERSON: [
    ...READ_ALL,
    P.CLIENTS_CREATE,
    P.CLIENTS_UPDATE,
    P.FOLLOWUPS_CREATE,
    P.FOLLOWUPS_UPDATE,
    P.NOTES_CREATE,
  ],
  ACCOUNTANT: [...READ_ALL, P.REPORTS_READ, P.EXPORTS_CREATE],
  VIEWER: READ_ALL,
};

/**
 * Effective permissions for a membership. Owners always hold every permission
 * (including ones added in future releases); everyone else holds exactly the
 * permissions stored on their membership.
 */
export function resolvePermissions(role: Role, stored: readonly string[]): Permission[] {
  if (role === ROLES.OWNER) return [...ALL_PERMISSIONS];
  return Array.from(new Set(stored.filter(isPermission)));
}
