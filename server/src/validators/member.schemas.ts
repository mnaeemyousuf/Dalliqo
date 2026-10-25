import { z } from 'zod';
import { ALL_PERMISSIONS, ALL_ROLES, type Permission } from '@recrm/shared';
import { MEMBER_STATUSES } from '../models/BusinessMember';
import { email, pagination, password, personName, phone } from './common';

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
  })
  .strict();

export const updateMemberSchema = z
  .object({
    role: z.enum(ALL_ROLES as [string, ...string[]]).optional(),
    permissions: permissionList.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const resetMemberPasswordSchema = z.object({ temporaryPassword: password }).strict();
