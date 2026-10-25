import type { Request, Response } from 'express';
import { authOf } from '../middleware/authenticate';
import type { AuditQuery } from '../repositories/auditLogRepository';
import { auditService } from '../services/auditService';
import { pageMeta, sendSuccess } from '../utils/http';

export const auditController = {
  async list(req: Request, res: Response) {
    const query = req.query as unknown as AuditQuery;
    const { items, total } = await auditService.list(authOf(req), query);
    sendSuccess(res, items, { meta: pageMeta(query.page, query.limit, total) });
  },
};
