import { Business } from '../models/Business';
import { normalizeCurrency } from '../utils/text';

const TTL_MS = 60_000;
const cache = new Map<string, { currency: string; timezone: string; at: number }>();

/**
 * A business's display settings (currency, timezone), cached briefly because every
 * authenticated request needs the currency. Saving the business profile clears the entry.
 */
export const regionService = {
  async of(businessId: string): Promise<{ currency: string; timezone: string }> {
    const hit = cache.get(businessId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit;
    const b = await Business.findById(businessId).select('currency timezone').lean<{ currency?: string; timezone?: string }>();
    const entry = { currency: normalizeCurrency(b?.currency), timezone: b?.timezone || 'Asia/Karachi', at: Date.now() };
    cache.set(businessId, entry);
    return entry;
  },

  forget(businessId: string): void {
    cache.delete(businessId);
  },
};
