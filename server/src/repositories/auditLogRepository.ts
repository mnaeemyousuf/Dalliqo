import type { ClientSession } from 'mongoose';
import { AuditLog, type AuditLogDoc } from '../models/AuditLog';
import type { TenantContext } from '../types/context';

export type NewAuditEntry = Omit<AuditLogDoc, '_id' | 'businessId' | 'actorUserId' | 'createdAt' | 'changes'> & {
  changes?: AuditLogDoc['changes'];
};

export interface AuditQuery {
  page: number;
  limit: number;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

export const auditLogRepository = {
  async create(ctx: TenantContext, entry: NewAuditEntry, session?: ClientSession) {
    await AuditLog.create([{ ...entry, businessId: ctx.businessId, actorUserId: ctx.userId }], { session });
  },

  async list(ctx: TenantContext, q: AuditQuery): Promise<{ items: AuditLogDoc[]; total: number }> {
    const filter: Record<string, unknown> = { businessId: ctx.businessId };
    if (q.entityType) filter.entityType = q.entityType;
    if (q.entityId) filter.entityId = q.entityId;
    if (q.actorUserId) filter.actorUserId = q.actorUserId;
    if (q.action) filter.action = q.action;
    if (q.from || q.to) {
      filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    }
    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('actorUserId', 'fullName email')
        .lean<AuditLogDoc[]>(),
      AuditLog.countDocuments(filter),
    ]);
    return { items, total };
  },
};
