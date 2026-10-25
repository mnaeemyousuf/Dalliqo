import type { ClientSession } from 'mongoose';
import { DEFAULT_CLIENT_CATEGORIES, ERROR_CODES } from '@recrm/shared';
import { ClientCategory } from '../models/ClientCategory';
import { categoryRepository, clientRepository } from '../repositories/entityRepositories';
import type { AuthContext, TenantContext } from '../types/context';
import { badRequest, conflict, forbidden } from '../utils/AppError';
import { isDuplicateKeyError } from '../utils/mongoErrors';

const URDU_NAMES: Record<string, string> = {
  PLOT_BUYER: 'پلاٹ خریدار',
  HOUSE_BUYER: 'مکان خریدار',
  FLAT_BUYER: 'فلیٹ / اپارٹمنٹ خریدار',
  PORTION_BUYER: 'پورشن خریدار',
  RENTAL_CLIENT: 'کرایہ دار',
  COMMERCIAL_CLIENT: 'کمرشل پراپرٹی کلائنٹ',
  PROPERTY_SELLER: 'پراپرٹی فروخت کنندہ',
  PROPERTY_OWNER: 'پراپرٹی مالک',
  INVESTOR: 'سرمایہ کار',
};

export const categoryService = {
  /** Runs inside the registration transaction for every new business. */
  async seedDefaults(ctx: TenantContext, session?: ClientSession): Promise<void> {
    await ClientCategory.create(
      DEFAULT_CLIENT_CATEGORIES.map((c, i) => ({
        businessId: ctx.businessId,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
        key: c.key,
        name: c.name,
        nameUr: URDU_NAMES[c.key],
        isSystem: true,
        sortOrder: (i + 1) * 10,
      })),
      { session, ordered: true },
    );
  },

  async list(ctx: TenantContext, includeArchived = false) {
    const items = await categoryRepository.find(ctx, includeArchived ? {} : { archivedAt: null }, { sort: { sortOrder: 1, name: 1 } });
    const counts = await clientRepository.aggregate<{ _id: unknown; n: number }>(ctx, {}, [{ $group: { _id: '$categoryId', n: { $sum: 1 } } }]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    return items.map((c) => ({ ...c, clientCount: byId.get(String(c._id)) ?? 0 }));
  },

  async create(auth: AuthContext, input: { name: string; nameUr?: string; sortOrder?: number; uuid?: string }) {
    const clash = await categoryRepository.findOne(auth, { name: new RegExp(`^${input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), archivedAt: null });
    if (clash) throw conflict(ERROR_CODES.DUPLICATE_KEY, 'A category with this name already exists');
    try {
      return await categoryRepository.create(auth, { ...input, isSystem: false, sortOrder: input.sortOrder ?? 500 });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict(ERROR_CODES.DUPLICATE_KEY, 'A category with this name already exists');
      throw err;
    }
  },

  async update(auth: AuthContext, id: string, input: { name?: string; nameUr?: string; sortOrder?: number; archived?: boolean }) {
    const current = await categoryRepository.getById(auth, id, 'Category not found');
    if (current.isSystem && input.archived) throw forbidden(ERROR_CODES.FORBIDDEN, 'Built-in categories cannot be archived');
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.nameUr !== undefined) set.nameUr = input.nameUr;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (input.archived !== undefined) set.archivedAt = input.archived ? new Date() : null;
    return categoryRepository.update(auth, id, set);
  },

  async ensureUsable(ctx: TenantContext, id: string) {
    const c = await categoryRepository.findOne(ctx, { _id: id, archivedAt: null });
    if (!c) throw badRequest(ERROR_CODES.CATEGORY_NOT_FOUND, 'Category not found or archived');
    return c;
  },
};
