import { Types, type ClientSession, type Model } from 'mongoose';
import { ERROR_CODES } from '@recrm/shared';
import { Branch, type BranchDoc } from '../models/Branch';
import type { TenantContext } from '../types/context';
import { badRequest, forbidden } from '../utils/AppError';

/**
 * Branch scoping (multi-branch businesses). Kept free of repository imports so the generic
 * tenant repository can use it without import cycles.
 */

const isObjectId = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

/** True when documents of this model belong to a branch. */
export function hasBranchPath(model: Model<never> | Model<unknown>): boolean {
  return Boolean(model.schema.paths.branchId);
}

/** Read filter for a branch-scoped collection ({} when the context sees every branch). */
export function branchFilter(ctx: TenantContext, field = 'branchId'): Record<string, unknown> {
  return ctx.branchIds ? { [field]: { $in: ctx.branchIds.map((id) => new Types.ObjectId(id)) } } : {};
}

/** True if this context may see records of the branch. */
export function canSeeBranch(ctx: TenantContext, branchId: unknown): boolean {
  return !ctx.branchIds || ctx.branchIds.includes(String(branchId));
}

/** True if this context may write records into the branch. */
export function canWriteBranch(ctx: TenantContext, branchId: unknown): boolean {
  return !ctx.allowedBranchIds || ctx.allowedBranchIds.includes(String(branchId));
}

// Default branch per business, cached (it never changes once created).
const defaults = new Map<string, string>();

/**
 * The business's default branch. Created on demand ("Main Branch") so a business is never left
 * without one, e.g. if it registered before branches existed and the migration has not run yet.
 */
export async function defaultBranchId(ctx: TenantContext, session?: ClientSession): Promise<string> {
  const hit = defaults.get(ctx.businessId);
  if (hit) return hit;
  let doc = await Branch.findOne({ businessId: ctx.businessId, isDefault: true }).session(session ?? null).lean<BranchDoc>();
  if (!doc) {
    try {
      [doc] = (await Branch.create([{ businessId: ctx.businessId, name: 'Main Branch', nameUr: 'مرکزی برانچ', isDefault: true, createdBy: ctx.userId, updatedBy: ctx.userId }], { session })).map((d) => d.toObject());
    } catch (err) {
      // Created concurrently (unique partial index on isDefault): read the winner.
      doc = await Branch.findOne({ businessId: ctx.businessId, isDefault: true }).session(session ?? null).lean<BranchDoc>();
      if (!doc) throw err;
    }
  }
  const id = String(doc!._id);
  defaults.set(ctx.businessId, id);
  return id;
}

export function forgetDefaultBranch(businessId: string): void {
  defaults.delete(businessId);
}

async function assertBranch(ctx: TenantContext, id: string): Promise<void> {
  if (!isObjectId(id)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Invalid branch');
  const b = await Branch.findOne({ businessId: ctx.businessId, _id: id, deletedAt: null, archivedAt: null }).select('_id').lean();
  if (!b) throw badRequest(ERROR_CODES.BRANCH_NOT_FOUND, 'Branch not found');
  if (!canWriteBranch(ctx, id)) throw forbidden(ERROR_CODES.BRANCH_FORBIDDEN, 'You do not have access to this branch');
}

/**
 * Branch for a new (or moved) record: the requested branch (must exist and be allowed), else the
 * branch picked in the switcher, else the member's only branch, else the business default (or
 * the member's first branch if the default is outside their branches).
 */
export async function resolveBranchForWrite(ctx: TenantContext, requested?: unknown, session?: ClientSession): Promise<string> {
  if (requested !== undefined && requested !== null && requested !== '') {
    await assertBranch(ctx, String(requested));
    return String(requested);
  }
  if (ctx.selectedBranchId) return ctx.selectedBranchId;
  if (ctx.allowedBranchIds?.length === 1) return ctx.allowedBranchIds[0];
  const def = await defaultBranchId(ctx, session);
  if (ctx.allowedBranchIds && !ctx.allowedBranchIds.includes(def)) {
    if (!ctx.allowedBranchIds.length) throw forbidden(ERROR_CODES.BRANCH_FORBIDDEN, 'You are not assigned to any branch');
    return ctx.allowedBranchIds[0];
  }
  return def;
}

/**
 * Applies the branch switcher header: the request then sees (and creates into) that one branch.
 * A branch outside the member's branches is refused, never silently widened.
 */
export async function narrowToSelectedBranch<T extends TenantContext>(ctx: T, header: string | undefined): Promise<T> {
  if (!header || header === 'all') return ctx;
  if (!isObjectId(header)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Invalid branch');
  if (!canSeeBranch(ctx, header)) throw forbidden(ERROR_CODES.BRANCH_FORBIDDEN, 'You do not have access to this branch');
  const exists = await Branch.findOne({ businessId: ctx.businessId, _id: header, deletedAt: null }).select('_id').lean();
  if (!exists) throw badRequest(ERROR_CODES.BRANCH_NOT_FOUND, 'Branch not found');
  return { ...ctx, branchIds: [header], selectedBranchId: header };
}
