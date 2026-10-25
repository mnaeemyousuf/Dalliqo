import type { Request, Response } from 'express';
import { ALL_PERMISSIONS, ASSIGNABLE_ROLES, PERMISSION_GROUPS, ROLE_PRESETS } from '@recrm/shared';
import { sendSuccess } from '../utils/http';

export const metaController = {
  /** Catalogue for permission editors; authorization itself never trusts the client. */
  permissions(_req: Request, res: Response) {
    sendSuccess(res, {
      permissions: ALL_PERMISSIONS,
      groups: PERMISSION_GROUPS,
      assignableRoles: ASSIGNABLE_ROLES,
      rolePresets: Object.fromEntries(ASSIGNABLE_ROLES.map((r) => [r, ROLE_PRESETS[r]])),
    });
  },
};
