import type { Request, Response } from 'express';
import { authOf } from '../middleware/authenticate';
import { memberService } from '../services/memberService';
import { pageMeta, sendSuccess } from '../utils/http';
import { requestMeta } from './authController';

export const memberController = {
  async list(req: Request, res: Response) {
    const { page, limit, status } = req.query as unknown as { page: number; limit: number; status?: never };
    const { items, total } = await memberService.list(authOf(req), { page, limit, status });
    sendSuccess(res, items, { meta: pageMeta(page, limit, total) });
  },

  async get(req: Request, res: Response) {
    sendSuccess(res, await memberService.get(authOf(req), req.params.id));
  },

  async create(req: Request, res: Response) {
    const member = await memberService.create(authOf(req), req.body, requestMeta(req));
    sendSuccess(res, member, { status: 201, message: 'Member added successfully' });
  },

  async update(req: Request, res: Response) {
    const member = await memberService.update(authOf(req), req.params.id, req.body, requestMeta(req));
    sendSuccess(res, member, { message: 'Member updated successfully' });
  },

  async remove(req: Request, res: Response) {
    await memberService.remove(authOf(req), req.params.id, requestMeta(req));
    sendSuccess(res, null, { message: 'Member removed' });
  },

  async resetPassword(req: Request, res: Response) {
    await memberService.resetPassword(authOf(req), req.params.id, req.body.temporaryPassword, requestMeta(req));
    sendSuccess(res, null, { message: 'Temporary password set. The member must change it at next sign-in.' });
  },
};
