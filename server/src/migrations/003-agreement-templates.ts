import { Types } from 'mongoose';
import { Business } from '../models/Business';
import { agreementService } from '../services/agreementService';

/**
 * Agreements: seeds the built-in templates (sale, rent and token receipt, in English and Urdu) for every
 * existing business. Idempotent: templates are matched by key, so a second run creates nothing.
 */
export async function migrateAgreementTemplates(): Promise<{ businesses: number; templatesCreated: number }> {
  const result = { businesses: 0, templatesCreated: 0 };
  const businesses = await Business.find({}).select('_id ownerUserId').lean();
  for (const b of businesses) {
    result.businesses++;
    result.templatesCreated += await agreementService.seedTemplates({ businessId: b._id as Types.ObjectId, userId: b.ownerUserId as Types.ObjectId } as never);
  }
  return result;
}
