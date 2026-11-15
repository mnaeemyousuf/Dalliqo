import { logger } from '../config/logger';
import { Activity } from '../models/Activity';
import { AuditLog } from '../models/AuditLog';
import { Settings, type SettingsDoc } from '../models/Settings';

const monthsAgo = (now: Date, months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));

/**
 * Data retention. Each business chooses how long its audit log and activity feed are kept
 * (Settings → Security); 0 keeps them forever, which is the default. Business records
 * (clients, deals, money, agreements, documents) are never removed by retention.
 */
export const retentionService = {
  /** Removes entries older than each business's retention period. Returns how many were removed. */
  async purgeAll(now = new Date()): Promise<number> {
    let removed = 0;
    // Cross-tenant by design: a background job walking every business that set a period.
    const rows = await Settings.find({ $or: [{ 'retention.auditLogMonths': { $gt: 0 } }, { 'retention.activityMonths': { $gt: 0 } }] })
      .setOptions({ skipTenantGuard: true })
      .select('businessId retention')
      .lean<SettingsDoc[]>();
    for (const s of rows) {
      try {
        const audit = s.retention?.auditLogMonths ?? 0;
        const activity = s.retention?.activityMonths ?? 0;
        if (audit > 0) removed += (await AuditLog.deleteMany({ businessId: s.businessId, createdAt: { $lt: monthsAgo(now, audit) } })).deletedCount ?? 0;
        if (activity > 0) removed += (await Activity.deleteMany({ businessId: s.businessId, createdAt: { $lt: monthsAgo(now, activity) } })).deletedCount ?? 0;
      } catch (err) {
        logger.error({ err, businessId: s.businessId }, 'Retention purge failed for business');
      }
    }
    return removed;
  },
};
