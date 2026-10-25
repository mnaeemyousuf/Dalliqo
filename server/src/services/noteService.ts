import { ERROR_CODES, PERMISSIONS, type EntityType } from '@recrm/shared';
import { Client } from '../models/Client';
import { FollowUp } from '../models/FollowUp';
import { Property } from '../models/Property';
import { PropertyOwner } from '../models/PropertyOwner';
import { noteRepository } from '../repositories/entityRepositories';
import type { AuthContext, TenantContext } from '../types/context';
import { badRequest, forbidden } from '../utils/AppError';
import { activityService } from './activityService';

const ENTITY_MODELS = { client: Client, property: Property, owner: PropertyOwner, followUp: FollowUp } as const;

/** Confirms the record exists in this business; returns a label for timelines. */
export async function assertEntity(ctx: TenantContext, entityType: EntityType, entityId: string): Promise<string> {
  const model = ENTITY_MODELS[entityType] as unknown as typeof Client;
  const doc = await model.findOne({ businessId: ctx.businessId, _id: entityId, deletedAt: null }).lean<Record<string, unknown>>();
  if (!doc) throw badRequest(ERROR_CODES.ENTITY_NOT_FOUND, `${entityType} not found`);
  return String(doc.fullName ?? doc.propertyId ?? doc.type ?? entityType);
}

export const noteService = {
  list(ctx: TenantContext, q: { entityType: EntityType; entityId: string; page: number; limit: number }) {
    return noteRepository.list(ctx, { entityType: q.entityType, entityId: q.entityId }, {
      page: q.page,
      limit: q.limit,
      sort: { createdAt: -1 },
      populate: [{ path: 'createdBy', select: 'fullName' }],
    });
  },

  async create(auth: AuthContext, input: { uuid?: string; entityType: EntityType; entityId: string; content: string }) {
    if (input.uuid) {
      const existing = await noteRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    const label = await assertEntity(auth, input.entityType, input.entityId);
    const note = await noteRepository.create(auth, input);
    const preview = input.content.length > 80 ? `${input.content.slice(0, 77)}…` : input.content;
    await activityService.record(auth, 'NOTE_ADDED', `Note on ${label}: ${preview}`, [{ entityType: input.entityType, entityId: input.entityId, label }]);
    return note;
  },

  async update(auth: AuthContext, id: string, content: string, baseVersion?: number) {
    const note = await noteRepository.getById(auth, id, 'Note not found');
    this.assertCanEdit(auth, note.createdBy.toString());
    return noteRepository.update(auth, id, { content }, { baseVersion });
  },

  async remove(auth: AuthContext, id: string, baseVersion?: number) {
    const note = await noteRepository.getById(auth, id, 'Note not found');
    this.assertCanEdit(auth, note.createdBy.toString());
    return noteRepository.softDelete(auth, id, { baseVersion });
  },

  assertCanEdit(auth: AuthContext, authorId: string) {
    if (authorId !== auth.userId && !auth.permissions.includes(PERMISSIONS.NOTES_MANAGE_ALL)) {
      throw forbidden(ERROR_CODES.FORBIDDEN, 'You can only change your own notes');
    }
  },
};
