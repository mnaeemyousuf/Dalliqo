import { Types } from 'mongoose';
import type { ActivityType, EntityType } from '@recrm/shared';
import { logger } from '../config/logger';
import { Activity, type ActivityDoc } from '../models/Activity';
import { Client } from '../models/Client';
import { Deal } from '../models/Deal';
import { FollowUp } from '../models/FollowUp';
import { Property } from '../models/Property';
import { PropertyOwner } from '../models/PropertyOwner';
import { branchFilter } from './branchScope';

/** Models whose records carry a branch; the timeline entry inherits it from the first such ref. */
const BRANCHED = { deal: Deal, client: Client, property: Property, owner: PropertyOwner, followUp: FollowUp } as unknown as Partial<Record<string, typeof Client>>;

async function branchOf(ctx: TenantContext, refs: ActivityRef[]): Promise<Types.ObjectId | null> {
  for (const r of refs) {
    const model = BRANCHED[r.entityType];
    if (!model) continue;
    const doc = await model.findOne({ businessId: ctx.businessId, _id: r.entityId }).select('branchId').lean<{ branchId?: Types.ObjectId }>();
    if (doc?.branchId) return doc.branchId;
  }
  return null;
}
import type { TenantContext } from '../types/context';

const READ_PERMISSION: Record<EntityType, string> = { client: 'clients:read', property: 'properties:read', owner: 'owners:read', followUp: 'followups:read', deal: 'deals:read', transaction: 'finance:read', agreement: 'agreements:read' };

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
        branchId: await branchOf(ctx, refs),
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
    // Branch-restricted members see their branches' entries plus business-level ones.
    if (ctx.branchIds) filter.$or = [branchFilter(ctx), { branchId: null }];
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
