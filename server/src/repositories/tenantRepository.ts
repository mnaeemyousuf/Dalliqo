import type { ClientSession, Model, PipelineStage, SortOrder } from 'mongoose';
import { ERROR_CODES, type ErrorCode } from '@recrm/shared';
import type { TenantContext } from '../types/context';
import { conflict, notFound } from '../utils/AppError';

export type Filter = Record<string, unknown>;

export interface ListOptions {
  page: number;
  limit: number;
  sort?: Record<string, SortOrder>;
  select?: string;
  populate?: { path: string; select: string }[];
}

export interface UpdateOptions {
  /** If given, the write only succeeds when the stored version still equals it. */
  baseVersion?: number;
  unset?: string[];
  session?: ClientSession;
}

/**
 * Generic tenant-scoped data access for syncable entities. Every query is
 * built from the TenantContext, soft-deleted rows are hidden unless asked for,
 * and updates bump `version` atomically.
 */
export function createTenantRepository<T extends { _id: unknown }>(model: Model<T>, notFoundCode: ErrorCode) {
  const scope = (ctx: TenantContext, filter: Filter = {}, includeDeleted = false): Filter => ({
    ...filter,
    businessId: ctx.businessId,
    ...(includeDeleted ? {} : { deletedAt: null }),
  });

  return {
    model,
    scope,

    async create(ctx: TenantContext, data: Filter, session?: ClientSession): Promise<T> {
      const [doc] = await model.create(
        [{ ...data, businessId: ctx.businessId, createdBy: ctx.userId, updatedBy: ctx.userId }],
        { session },
      );
      return doc.toObject() as T;
    },

    findById(ctx: TenantContext, id: string, opts: { includeDeleted?: boolean; session?: ClientSession } = {}) {
      return model.findOne(scope(ctx, { _id: id }, opts.includeDeleted)).session(opts.session ?? null).lean<T>();
    },

    async getById(ctx: TenantContext, id: string, message = 'Record not found'): Promise<T> {
      const doc = await model.findOne(scope(ctx, { _id: id })).lean<T>();
      if (!doc) throw notFound(notFoundCode, message);
      return doc;
    },

    findByUuid(ctx: TenantContext, uuid: string) {
      return model.findOne(scope(ctx, { uuid }, true)).lean<T>();
    },

    findOne(ctx: TenantContext, filter: Filter) {
      return model.findOne(scope(ctx, filter)).lean<T>();
    },

    find(ctx: TenantContext, filter: Filter, opts: { sort?: Record<string, SortOrder>; limit?: number; select?: string } = {}) {
      let q = model.find(scope(ctx, filter));
      if (opts.sort) q = q.sort(opts.sort);
      if (opts.limit) q = q.limit(opts.limit);
      if (opts.select) q = q.select(opts.select);
      return q.lean<T[]>();
    },

    async list(ctx: TenantContext, filter: Filter, opts: ListOptions): Promise<{ items: T[]; total: number }> {
      const scoped = scope(ctx, filter);
      let q = model
        .find(scoped)
        .sort(opts.sort ?? { updatedAt: -1, _id: -1 })
        .skip((opts.page - 1) * opts.limit)
        .limit(opts.limit);
      if (opts.select) q = q.select(opts.select);
      // Populated ids come from already-scoped documents (see scopedPopulate).
      for (const p of opts.populate ?? []) q = q.populate({ path: p.path, select: p.select, options: { skipTenantGuard: true } });
      const [items, total] = await Promise.all([q.lean<T[]>(), model.countDocuments(scoped)]);
      return { items, total };
    },

    count(ctx: TenantContext, filter: Filter = {}) {
      return model.countDocuments(scope(ctx, filter));
    },

    aggregate<R>(ctx: TenantContext, match: Filter, stages: PipelineStage[]) {
      return model.aggregate<R>([{ $match: scope(ctx, match) }, ...stages]);
    },

    /**
     * Atomic versioned update. Returns the updated document. Throws 404 when the
     * record doesn't exist (in this business) and 409 VERSION_CONFLICT when
     * `baseVersion` is stale.
     */
    async update(ctx: TenantContext, id: string, set: Filter, opts: UpdateOptions = {}): Promise<T> {
      const filter = scope(ctx, { _id: id, ...(opts.baseVersion !== undefined ? { version: opts.baseVersion } : {}) });
      const update: Filter = { $set: { ...set, updatedBy: ctx.userId }, $inc: { version: 1 } };
      if (opts.unset?.length) update.$unset = Object.fromEntries(opts.unset.map((f) => [f, 1]));
      const doc = await model
        .findOneAndUpdate(filter, update, { new: true, runValidators: true, session: opts.session })
        .lean<T>();
      if (doc) return doc;
      const current = await model.findOne(scope(ctx, { _id: id })).lean<T & { version: number }>();
      if (!current) throw notFound(notFoundCode, 'Record not found');
      throw conflict(ERROR_CODES.VERSION_CONFLICT, 'This record was modified by someone else', {
        serverVersion: current.version,
        server: current,
      });
    },

    async softDelete(ctx: TenantContext, id: string, opts: UpdateOptions = {}): Promise<T> {
      return this.update(ctx, id, { deletedAt: new Date() }, opts);
    },

    /** Delta feed for sync pull: everything (incl. tombstones) after the cursor. */
    changedSince(ctx: TenantContext, after: { updatedAt: Date; id: string } | null, limit: number) {
      const filter: Filter = { businessId: ctx.businessId };
      if (after) {
        filter.$or = [{ updatedAt: { $gt: after.updatedAt } }, { updatedAt: after.updatedAt, _id: { $gt: after.id } }];
      }
      return model.find(filter).sort({ updatedAt: 1, _id: 1 }).limit(limit).lean<T[]>();
    },
  };
}
