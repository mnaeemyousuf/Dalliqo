import { ROLES } from '@recrm/shared';
import { BusinessMember } from '../models/BusinessMember';

/**
 * Phase 4 permissions. Keeps existing members working as before:
 *  - members who can edit properties may submit listings for verification;
 *  - members who could upload documents keep seeing identity / title documents.
 * Only owners and members given verification:decide can approve verifications.
 */
export async function migratePhase4(): Promise<{ submit: number; sensitive: number }> {
  const skip = { skipTenantGuard: true } as never;
  const submit = await BusinessMember.updateMany(
    { role: { $ne: ROLES.OWNER }, permissions: 'properties:update' },
    { $addToSet: { permissions: 'verification:submit' } },
  ).setOptions(skip);
  const sensitive = await BusinessMember.updateMany(
    { role: { $ne: ROLES.OWNER }, permissions: 'documents:upload' },
    { $addToSet: { permissions: 'documents:read_sensitive' } },
  ).setOptions(skip);
  // Members who could manage commissions can approve deal closings (approvals are off until switched on).
  await BusinessMember.updateMany({ role: { $ne: ROLES.OWNER }, permissions: 'commissions:manage' }, { $addToSet: { permissions: 'deals:approve' } }).setOptions(skip);
  return { submit: submit.modifiedCount, sensitive: sensitive.modifiedCount };
}
