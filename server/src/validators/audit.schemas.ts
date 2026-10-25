import { z } from 'zod';
import { objectId, pagination } from './common';

export const listAuditQuery = pagination.extend({
  entityType: z.string().trim().max(50).optional(),
  entityId: objectId.optional(),
  actorUserId: objectId.optional(),
  action: z.string().trim().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
