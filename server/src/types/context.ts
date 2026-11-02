import type { Permission, Role } from '@recrm/shared';

/** Minimum scope every repository call on tenant data needs. */
export interface TenantContext {
  businessId: string;
  userId: string;
  /**
   * Branch read scope. undefined = every branch (owners, members with branch access ALL and
   * background jobs); otherwise only these branch ids — narrowed to one branch when the app
   * sends the branch switcher header (X-Branch-Id).
   */
  branchIds?: string[];
  /** Branches this member may write to (undefined = any branch of the business). */
  allowedBranchIds?: string[];
  /** Branch picked in the branch switcher, used as the default for new records. */
  selectedBranchId?: string;
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
