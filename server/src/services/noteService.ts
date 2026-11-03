import { ERROR_CODES, PERMISSIONS, type EntityType } from '@recrm/shared';
import { Client } from '../models/Client';
import { Deal } from '../models/Deal';
import { Transaction } from '../models/Transaction';
import { FollowUp } from '../models/FollowUp';
import { Property } from '../models/Property';
import { PropertyOwner } from '../models/PropertyOwner';
import { noteRepository } from '../repositories/entityRepositories';
import type { AuthContext, TenantContext } from '../types/context';
import { badRequest, forbidden } from '../utils/AppError';
import { branchFilter } from './branchScope';
import { activityService } from './activityService';

const ENTITY_MODELS = { client: Client, property: Property, owner: PropertyOwner, followUp: FollowUp, deal: Deal, transaction: Transaction } as const;

/** Confirms the record exists in this business (and the member's branches); returns a label for timelines. */
export async function assertEntity(ctx: TenantContext, entityType: EntityType, entityId: string): Promise<string> {
  return (await entityInfo(ctx, entityType, entityId)).label;
}

/** Label and branch of a record notes, documents and activities can be attached to. */
export async function entityInfo(ctx: TenantContext, entityType: EntityType, entityId: string): Promise<{ label: string; branchId?: string }> {
  const model = ENTITY_MODELS[entityType] as unknown as typeof Client;
  const doc = await model.findOne({ businessId: ctx.businessId, _id: entityId, deletedAt: null, ...branchFilter(ctx) }).lean<Record<string, unknown>>();
  if (!doc) throw badRequest(ERROR_CODES.ENTITY_NOT_FOUND, `${entityType} not found`);
  return { label: String(doc.fullName ?? doc.propertyId ?? doc.dealNo ?? (doc.amount != null ? `${doc.type} ${doc.amount}` : entityType)), branchId: doc.branchId ? String(doc.branchId) : undefined };
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
    const { label, branchId } = await entityInfo(auth, input.entityType, input.entityId);
    const note = await noteRepository.create(auth, { ...input, branchId });
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
