import { Types } from 'mongoose';
import { Business } from '../models/Business';
import { transactionService } from '../services/transactionService';

/**
 * Income & expense: seeds the built-in categories (with Urdu names) for every existing business.
 * Idempotent: categories are matched by their key, so a second run creates nothing.
 */
export async function migrateFinanceCategories(): Promise<{ businesses: number; categoriesCreated: number }> {
  const result = { businesses: 0, categoriesCreated: 0 };
  const businesses = await Business.find({}).select('_id ownerUserId').lean();
  for (const b of businesses) {
    result.businesses++;
    result.categoriesCreated += await transactionService.seedCategories({ businessId: b._id as Types.ObjectId, userId: b.ownerUserId as Types.ObjectId } as never);
  }
  return result;
}
