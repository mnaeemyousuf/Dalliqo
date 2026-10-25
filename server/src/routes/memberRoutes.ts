import { Router } from 'express';
import { PERMISSIONS } from '@recrm/shared';
import { memberController } from '../controllers/memberController';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/http';
import { idParams } from '../validators/common';
import { createMemberSchema, listMembersQuery, resetMemberPasswordSchema, updateMemberSchema } from '../validators/member.schemas';

const r = Router();
const canRead = requirePermission(PERMISSIONS.MEMBERS_READ);
const canManage = requirePermission(PERMISSIONS.MEMBERS_MANAGE);

r.get('/', canRead, validate({ query: listMembersQuery }), asyncHandler(memberController.list));
r.post('/', canManage, validate({ body: createMemberSchema }), asyncHandler(memberController.create));
r.get('/:id', canRead, validate({ params: idParams }), asyncHandler(memberController.get));
r.patch('/:id', canManage, validate({ params: idParams, body: updateMemberSchema }), asyncHandler(memberController.update));
r.delete('/:id', canManage, validate({ params: idParams }), asyncHandler(memberController.remove));
r.post(
  '/:id/reset-password',
  canManage,
  validate({ params: idParams, body: resetMemberPasswordSchema }),
  asyncHandler(memberController.resetPassword),
);

export default r;
