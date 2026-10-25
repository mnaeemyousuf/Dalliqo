import { Types } from 'mongoose';
import type { ActivityType, EntityType } from '@recrm/shared';
import { logger } from '../config/logger';
import { Activity, type ActivityDoc } from '../models/Activity';
import type { TenantContext } from '../types/context';

const READ_PERMISSION: Record<EntityType, string> = { client: 'clients:read', property: 'properties:read', owner: 'owners:read', followUp: 'followups:read' };

export interface ActivityRef {
  entityType: EntityType;
  entityId: string | Types.ObjectId;
  label?: string;
}

export const activityService = {
  /** Timeline entries never fail the action that produced them. */
  async record(ctx: TenantContext, type: ActivityType, summary: string, refs: ActivityRef[], data?: Record<string, unknown>) {
    try {
      await Activity.create({
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        type,
        summary,
        refs: refs.map((r) => ({ ...r, entityId: new Types.ObjectId(String(r.entityId)) })),
        data,
      });
    } catch (err) {
      logger.error({ err, type }, 'Failed to record activity');
    }
  },

  /**
   * Timeline entries mention client names, prices and so on, so entries touching a
   * record type the user may not read are left out (e.g. a member without clients:read).
   */
  async list(ctx: TenantContext & { permissions?: readonly string[] }, q: { entityId?: string; page: number; limit: number }) {
    const filter: Record<string, unknown> = { businessId: ctx.businessId };
    if (q.entityId) filter['refs.entityId'] = q.entityId;
    if (ctx.permissions) {
      const hidden = Object.entries(READ_PERMISSION).filter(([, p]) => !ctx.permissions!.includes(p)).map(([type]) => type);
      if (hidden.length) filter['refs.entityType'] = { $nin: hidden };
    }
    const [items, total] = await Promise.all([
      Activity.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('actorUserId', 'fullName')
        .lean<ActivityDoc[]>(),
      Activity.countDocuments(filter),
    ]);
    return { items, total };
  },
};
