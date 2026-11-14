import { ROLES } from '@recrm/shared';
import { BusinessMember } from '../models/BusinessMember';

/** Marketing: whoever could manage settings (or is a marketing manager) can run the website and campaigns. */
export async function migrateMarketing(): Promise<{ granted: number }> {
  const r = await BusinessMember.updateMany(
    { role: { $ne: ROLES.OWNER }, $or: [{ permissions: 'settings:manage' }, { role: { $in: ['MANAGER', 'MARKETING_MANAGER'] } }] },
    { $addToSet: { permissions: 'marketing:manage' } },
  ).setOptions({ skipTenantGuard: true } as never);
  return { granted: r.modifiedCount };
}
