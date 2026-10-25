import type { Permission, Role } from '@recrm/shared';

/** Minimum scope every repository call on tenant data needs. */
export interface TenantContext {
  businessId: string;
  userId: string;
}

/** Resolved identity of an authenticated request or socket. */
export interface AuthContext extends TenantContext {
  memberId: string;
  sessionId: string;
  role: Role;
  permissions: Permission[];
  mustChangePassword: boolean;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}
