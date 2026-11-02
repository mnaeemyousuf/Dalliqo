import { Types, type ClientSession } from 'mongoose';
import { ERROR_CODES, SOCKET_EVENTS } from '@recrm/shared';
import { Branch, type BranchDoc } from '../models/Branch';
import { BusinessMember } from '../models/BusinessMember';
import { createTenantRepository } from '../repositories/tenantRepository';
import type { AuthContext, RequestMeta, TenantContext } from '../types/context';
import { badRequest, conflict, notFound } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { auditService } from './auditService';
import { canSeeBranch, forgetDefaultBranch } from './branchScope';
import { publishChange } from './publish';

export const branchRepository = createTenantRepository<BranchDoc>(Branch, ERROR_CODES.BRANCH_NOT_FOUND);

export interface BranchInput {
  uuid?: string;
  name: string;
  nameUr?: string;
  code?: string;
  address?: string;
  phone?: string;
}

const FIELDS = ['name', 'nameUr', 'code', 'address', 'phone'] as const;

export const branchService = {
  /** Default branch for a business being registered (inside the registration transaction). */
  async createDefault(ctx: TenantContext, session?: ClientSession): Promise<BranchDoc> {
    const [doc] = await Branch.create(
      [{ businessId: ctx.businessId, name: 'Main Branch', nameUr: 'مرکزی برانچ', isDefault: true, createdBy: ctx.userId, updatedBy: ctx.userId }],
      { session },
    );
    return doc.toObject();
  },

  /**
   * Branches this member can see (the branch switcher's options). Every member may list them;
   * a branch-restricted member only gets their own branches.
   */
  async list(ctx: TenantContext, q: { includeArchived?: boolean } = {}) {
    const filter: Record<string, unknown> = { businessId: ctx.businessId, deletedAt: null };
    if (!q.includeArchived) filter.archivedAt = null;
    // The member's own branches, not the switcher-narrowed scope: the switcher needs every option.
    const allowed = ctx.allowedBranchIds;
    if (allowed) filter._id = { $in: allowed };
    return Branch.find(filter).sort({ isDefault: -1, name: 1 }).lean<BranchDoc[]>();
  },

  async get(ctx: TenantContext, id: string) {
    const b = await Branch.findOne({ businessId: ctx.businessId, _id: id, deletedAt: null }).lean<BranchDoc>();
    if (!b || (ctx.allowedBranchIds && !ctx.allowedBranchIds.includes(id))) throw notFound(ERROR_CODES.BRANCH_NOT_FOUND, 'Branch not found');
    return b;
  },

  async create(auth: AuthContext, input: BranchInput, meta: RequestMeta = {}) {
    if (input.uuid) {
      const existing = await branchRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    await assertUniqueName(auth, input.name);
    const branch = await branchRepository.create(auth, { ...input, isDefault: false });
    await auditService.record(auth, { action: 'branch.created', entityType: 'branch', entityId: branch._id, entityLabel: branch.name, ip: meta.ip });
    publishChange(auth, SOCKET_EVENTS.BRANCH_CREATED, 'branch', branch);
    return branch;
  },

  async update(auth: AuthContext, id: string, input: Partial<BranchInput> & { archived?: boolean }, opts: { baseVersion?: number; meta?: RequestMeta } = {}) {
    const before = await this.get(auth, id);
    const set: Record<string, unknown> = {};
    for (const k of FIELDS) if (input[k] !== undefined) set[k] = input[k];
    if (input.name && input.name !== before.name) await assertUniqueName(auth, input.name, id);
    if (input.archived !== undefined) {
      if (input.archived && before.isDefault) throw conflict(ERROR_CODES.BRANCH_IS_DEFAULT, 'The main branch cannot be archived');
      set.archivedAt = input.archived ? new Date() : null;
    }
    const updated = await branchRepository.update(auth, id, set, { baseVersion: opts.baseVersion });
    const changes = diffFields(before as unknown as Record<string, unknown>, set, [...FIELDS, 'archivedAt']);
    if (changes.length) {
      await auditService.record(auth, { action: input.archived ? 'branch.archived' : 'branch.updated', entityType: 'branch', entityId: updated._id, entityLabel: updated.name, changes, ip: opts.meta?.ip });
    }
    publishChange(auth, SOCKET_EVENTS.BRANCH_UPDATED, 'branch', updated);
    return updated;
  },

  /** Member counts per branch, for the branches screen. */
  async memberCounts(ctx: TenantContext): Promise<Record<string, number>> {
    const rows = await BusinessMember.aggregate<{ _id: unknown; n: number }>([
      { $match: { businessId: new Types.ObjectId(ctx.businessId), status: 'ACTIVE', branchAccess: 'SELECTED' } },
      { $unwind: '$branchIds' },
      { $group: { _id: '$branchIds', n: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
  },

  /** Validates branch ids for a membership (they must be live branches of this business). */
  async assertBranches(ctx: TenantContext, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const n = await Branch.countDocuments({ businessId: ctx.businessId, _id: { $in: ids }, deletedAt: null, archivedAt: null });
    if (n !== new Set(ids).size) throw badRequest(ERROR_CODES.BRANCH_NOT_FOUND, 'One of the branches does not exist');
  },

  canSee: canSeeBranch,
  forgetDefault: forgetDefaultBranch,
};

async function assertUniqueName(ctx: TenantContext, name: string, exceptId?: string) {
  const clash = await Branch.findOne({
    businessId: ctx.businessId,
    deletedAt: null,
    name: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  }).lean();
  if (clash) throw conflict(ERROR_CODES.DUPLICATE_KEY, 'A branch with this name already exists');
}
