import { z } from 'zod';
import { ALL_PERMISSIONS, ALL_ROLES, BRANCH_ACCESS, type Permission } from '@recrm/shared';
import { MEMBER_STATUSES } from '../models/BusinessMember';
import { email, objectId, pagination, password, personName, phone } from './common';

/** Branch access of a membership: every branch (default) or only the listed ones. */
const branchAccess = {
  branchAccess: z.enum(BRANCH_ACCESS).optional(),
  branchIds: z.array(objectId).max(50).optional(),
};
const branchesConsistent = (v: { branchAccess?: string; branchIds?: string[] }) => v.branchAccess !== 'SELECTED' || (v.branchIds?.length ?? 0) > 0;
const branchesMessage = { message: 'Choose at least one branch', path: ['branchIds'] };

const permissionList = z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length);

export const listMembersQuery = pagination.extend({ status: z.enum(MEMBER_STATUSES).optional() });

export const createMemberSchema = z
  .object({
    fullName: personName,
    email,
    mobileNumber: phone.optional(),
    temporaryPassword: password,
    role: z.enum(ALL_ROLES as [string, ...string[]]).optional(),
    permissions: permissionList.optional(),
    ...branchAccess,
  })
  .strict()
  .refine(branchesConsistent, branchesMessage);

export const updateMemberSchema = z
  .object({
    role: z.enum(ALL_ROLES as [string, ...string[]]).optional(),
    permissions: permissionList.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    ...branchAccess,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .refine(branchesConsistent, branchesMessage);

export const resetMemberPasswordSchema = z.object({ temporaryPassword: password }).strict();
