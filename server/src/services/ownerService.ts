import { ERROR_CODES, SOCKET_EVENTS } from '@recrm/shared';
import type { PropertyOwnerDoc } from '../models/PropertyOwner';
import { ownerRepository, propertyRepository } from '../repositories/entityRepositories';
import type { AuthContext, RequestMeta, TenantContext } from '../types/context';
import { conflict } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { escapeRegex, searchBlob } from '../utils/text';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { publishChange } from './publish';

export interface OwnerInput {
  uuid?: string;
  fullName: string;
  mobileNumber: string;
  alternateNumber?: string;
  whatsappNumber?: string;
  email?: string;
  address?: string;
  notes?: string;
}

const FIELDS = ['fullName', 'mobileNumber', 'alternateNumber', 'whatsappNumber', 'email', 'address', 'notes'] as const;

export const ownerService = {
  async create(auth: AuthContext, input: OwnerInput, meta: RequestMeta = {}): Promise<PropertyOwnerDoc> {
    if (input.uuid) {
      const existing = await ownerRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    const owner = await ownerRepository.create(auth, {
      ...input,
      whatsappNumber: input.whatsappNumber ?? input.mobileNumber,
      searchText: searchBlob(input.fullName, input.mobileNumber, input.whatsappNumber, input.email),
    });
    await activityService.record(auth, 'OWNER_CREATED', `Owner ${owner.fullName} added`, [{ entityType: 'owner', entityId: owner._id, label: owner.fullName }]);
    await auditService.record(auth, { action: 'owner.created', entityType: 'owner', entityId: owner._id, entityLabel: owner.fullName, ip: meta.ip });
    publishChange(auth, SOCKET_EVENTS.OWNER_CREATED, 'owner', owner);
    return owner;
  },

  list(ctx: TenantContext, q: { q?: string; page: number; limit: number; sort?: string }) {
    const filter: Record<string, unknown> = {};
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      if (digits.length >= 4) filter.mobileNumber = new RegExp(escapeRegex(digits.startsWith('0') ? digits.slice(1) : digits));
      else filter.$and = searchBlob(q.q).split(' ').filter(Boolean).map((t) => ({ searchText: new RegExp(`(^|\\s)${escapeRegex(t)}`) }));
    }
    const sort: Record<string, 1 | -1> = q.sort === 'fullName' ? { fullName: 1 } : q.sort === '-propertyCount' ? { propertyCount: -1 } : { updatedAt: -1 };
    return ownerRepository.list(ctx, filter, { page: q.page, limit: q.limit, sort });
  },

  async get(ctx: TenantContext, id: string) {
    const owner = await ownerRepository.getById(ctx, id, 'Owner not found');
    const properties = await propertyRepository.find(ctx, { ownerId: owner._id }, {
      sort: { updatedAt: -1 },
      select: 'propertyId propertyType listingPurpose status society area block size sizeUnit askingPrice coverThumbnailUrl',
    });
    return { ...owner, properties };
  },

  async update(auth: AuthContext, id: string, input: Partial<OwnerInput>, opts: { baseVersion?: number; meta?: RequestMeta } = {}) {
    const before = await ownerRepository.getById(auth, id, 'Owner not found');
    const set: Record<string, unknown> = {};
    for (const k of FIELDS) if (input[k] !== undefined) set[k] = input[k];
    const merged = { ...before, ...set };
    set.searchText = searchBlob(merged.fullName, merged.mobileNumber, merged.whatsappNumber, merged.email);
    const updated = await ownerRepository.update(auth, id, set, { baseVersion: opts.baseVersion });
    const changes = diffFields(before as unknown as Record<string, unknown>, set, FIELDS);
    if (changes.length) {
      await auditService.record(auth, { action: 'owner.updated', entityType: 'owner', entityId: updated._id, entityLabel: updated.fullName, changes, ip: opts.meta?.ip });
      await activityService.record(auth, 'OWNER_UPDATED', `Owner ${updated.fullName} updated`, [{ entityType: 'owner', entityId: updated._id, label: updated.fullName }]);
    }
    publishChange(auth, SOCKET_EVENTS.OWNER_UPDATED, 'owner', updated);
    return updated;
  },

  async remove(auth: AuthContext, id: string, opts: { baseVersion?: number; meta?: RequestMeta } = {}) {
    const owned = await propertyRepository.count(auth, { ownerId: id });
    if (owned > 0) throw conflict(ERROR_CODES.OWNER_HAS_PROPERTIES, `This owner still has ${owned} propert${owned === 1 ? 'y' : 'ies'}. Reassign or delete them first.`);
    const deleted = await ownerRepository.softDelete(auth, id, { baseVersion: opts.baseVersion });
    await auditService.record(auth, { action: 'owner.deleted', entityType: 'owner', entityId: deleted._id, entityLabel: deleted.fullName, ip: opts.meta?.ip });
    publishChange(auth, SOCKET_EVENTS.OWNER_UPDATED, 'owner', deleted);
    return deleted;
  },

  async refreshPropertyCount(ctx: TenantContext, ownerId: unknown) {
    if (!ownerId) return;
    const n = await propertyRepository.count(ctx, { ownerId });
    await ownerRepository.model.updateOne({ businessId: ctx.businessId, _id: ownerId }, { $set: { propertyCount: n } });
  },
};
