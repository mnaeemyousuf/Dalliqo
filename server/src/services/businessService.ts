import { ERROR_CODES, SOCKET_EVENTS } from '@recrm/shared';
import type { BusinessDoc } from '../models/Business';
import { businessRepository } from '../repositories/businessRepository';
import type { AuthContext, RequestMeta } from '../types/context';
import { notFound } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { eventBus } from '../utils/eventBus';
import { auditService } from './auditService';

const EDITABLE = ['name', 'phone', 'email', 'address', 'city', 'currency', 'timezone', 'defaultSizeUnit'] as const;
export type BusinessUpdate = Partial<Pick<BusinessDoc, (typeof EDITABLE)[number]>>;

export const businessService = {
  async getCurrent(auth: AuthContext): Promise<BusinessDoc> {
    const business = await businessRepository.findCurrent(auth);
    if (!business) throw notFound(ERROR_CODES.BUSINESS_NOT_FOUND, 'Business not found');
    return business;
  },

  async updateCurrent(auth: AuthContext, input: BusinessUpdate, meta: RequestMeta): Promise<BusinessDoc> {
    const before = await this.getCurrent(auth);
    const updated = await businessRepository.updateCurrent(auth, input);
    if (!updated) throw notFound(ERROR_CODES.BUSINESS_NOT_FOUND, 'Business not found');

    const changes = diffFields(before as unknown as Record<string, unknown>, input, EDITABLE);
    if (changes.length) {
      await auditService.record(auth, {
        action: 'business.updated',
        entityType: 'business',
        entityId: updated._id,
        entityLabel: updated.name,
        changes,
        ip: meta.ip,
      });
      eventBus.publish({
        name: SOCKET_EVENTS.BUSINESS_UPDATED,
        businessId: auth.businessId,
        actorUserId: auth.userId,
        entity: 'business',
        entityId: auth.businessId,
      });
    }
    return updated;
  },
};
