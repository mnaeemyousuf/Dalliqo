import { ROLES } from '@recrm/shared';
import { Business } from '../models/Business';
import { BusinessMember } from '../models/BusinessMember';
import { Deal } from '../models/Deal';
import { DEAL_CHECKLIST_ITEMS } from '@recrm/shared';

/**
 * Phase 3 (leads, inventory, negotiation, plans):
 *  - businesses created before plans existed get an explicit ENTERPRISE / ACTIVE subscription (no
 *    behaviour change: they keep every feature);
 *  - members who could edit properties keep seeing the floor price (new permission);
 *  - open deals without a closing checklist get the default one.
 * Idempotent: each step only touches documents still missing the new data.
 */
export async function migratePhase3(): Promise<{ subscriptions: number; floorPermission: number; checklists: number }> {
  const skip = { skipTenantGuard: true } as never;
  const subs = await Business.updateMany(
    { 'subscription.plan': { $exists: false } },
    { $set: { 'subscription.plan': 'ENTERPRISE', 'subscription.status': 'ACTIVE', 'subscription.cycle': null, 'subscription.history': [] } },
  );
  const floor = await BusinessMember.updateMany(
    { role: { $ne: ROLES.OWNER }, permissions: 'properties:update', 'permissions.0': { $exists: true } },
    { $addToSet: { permissions: 'properties:view_floor_price' } },
  ).setOptions(skip);
  const checklist = DEAL_CHECKLIST_ITEMS.map((key) => ({ key, done: false, doneAt: null, doneBy: null }));
  const deals = await Deal.updateMany({ $or: [{ checklist: { $exists: false } }, { checklist: { $size: 0 } }] }, { $set: { checklist } }).setOptions(skip);
  return { subscriptions: subs.modifiedCount, floorPermission: floor.modifiedCount, checklists: deals.modifiedCount };
}
