import type { ClientSession } from 'mongoose';
import { logger } from '../config/logger';
import { auditLogRepository, type AuditQuery, type NewAuditEntry } from '../repositories/auditLogRepository';
import type { TenantContext } from '../types/context';

export const auditService = {
  /**
   * Inside a transaction the audit write is part of it (and failures abort).
   * Outside one, an audit failure is logged but never fails the user's action.
   */
  async record(ctx: TenantContext, entry: NewAuditEntry, session?: ClientSession): Promise<void> {
    if (session) {
      await auditLogRepository.create(ctx, entry, session);
      return;
    }
    try {
      await auditLogRepository.create(ctx, entry);
    } catch (err) {
      logger.error({ err, action: entry.action }, 'Failed to write audit log');
    }
  },

  list(ctx: TenantContext, query: AuditQuery) {
    return auditLogRepository.list(ctx, query);
  },
};
