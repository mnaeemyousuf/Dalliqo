import type { SocketEventName } from '@recrm/shared';
import type { TenantContext } from '../types/context';
import { eventBus } from '../utils/eventBus';

/** Publishes a change notice for a record after its write committed. */
export function publishChange(
  ctx: TenantContext,
  name: SocketEventName,
  entity: string,
  doc: { _id: unknown; version?: number },
  data?: Record<string, unknown>,
): void {
  eventBus.publish({
    name,
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    entity,
    entityId: String(doc._id),
    version: doc.version,
    data,
  });
}
