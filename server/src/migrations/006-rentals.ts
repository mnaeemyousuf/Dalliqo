import { ROLES } from '@recrm/shared';
import { BusinessMember } from '../models/BusinessMember';

/** Rentals module: members who work with properties can see leases; property editors can manage them. */
export async function migrateRentals(): Promise<{ read: number; manage: number }> {
  const skip = { skipTenantGuard: true } as never;
  const read = await BusinessMember.updateMany({ role: { $ne: ROLES.OWNER }, permissions: 'properties:read' }, { $addToSet: { permissions: 'rentals:read' } }).setOptions(skip);
  const manage = await BusinessMember.updateMany({ role: { $ne: ROLES.OWNER }, permissions: 'properties:update' }, { $addToSet: { permissions: 'rentals:manage' } }).setOptions(skip);
  return { read: read.modifiedCount, manage: manage.modifiedCount };
}
