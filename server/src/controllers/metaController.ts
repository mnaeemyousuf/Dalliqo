import type { Request, Response } from 'express';
import { ALL_PERMISSIONS, ASSIGNABLE_ROLES, PERMISSION_GROUPS, ROLE_PRESETS } from '@recrm/shared';
import { sendSuccess } from '../utils/http';

const PERMISSION_TEMPLATES = ['MEMBER', 'MANAGER', 'AGENT', 'SALESPERSON', 'ACCOUNTANT', 'VIEWER'] as const;

export const metaController = {
  /** Catalogue for permission editors; authorization itself never trusts the client. */
  permissions(_req: Request, res: Response) {
    sendSuccess(res, {
      permissions: ALL_PERMISSIONS,
      groups: PERMISSION_GROUPS,
      assignableRoles: ASSIGNABLE_ROLES,
      rolePresets: Object.fromEntries(ASSIGNABLE_ROLES.map((r) => [r, ROLE_PRESETS[r]])),
      // Permission templates applied to a MEMBER (the web and mobile user editors offer the same ones).
      permissionTemplates: Object.fromEntries(PERMISSION_TEMPLATES.map((t) => [t, ROLE_PRESETS[t]])),
    });
  },
};
