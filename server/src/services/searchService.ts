import { PERMISSIONS } from '@recrm/shared';
import { scopedPopulate } from '../models/plugins/tenant';
import { Match } from '../models/Match';
import type { AuthContext } from '../types/context';
import { clientService } from './clientService';
import { ownerService } from './ownerService';
import { propertyService } from './propertyService';

export type SearchType = 'clients' | 'properties' | 'owners' | 'matches';

/** Global search across the record types the user may read. */
export const searchService = {
  async search(auth: AuthContext, q: string, types: SearchType[], limit = 5) {
    const can = (p: string) => auth.permissions.includes(p as never);
    const want = (t: SearchType) => types.includes(t);
    const page = { page: 1, limit };

    const [clients, properties, owners] = await Promise.all([
      want('clients') || want('matches') ? (can(PERMISSIONS.CLIENTS_READ) ? clientService.list(auth, { q, ...page }) : null) : null,
      want('properties') || want('matches') ? (can(PERMISSIONS.PROPERTIES_READ) ? propertyService.list(auth, { q, ...page }) : null) : null,
      want('owners') && can(PERMISSIONS.OWNERS_READ) ? ownerService.list(auth, { q, ...page }) : null,
    ]);

    let matches: unknown[] = [];
    if (want('matches') && can(PERMISSIONS.MATCHES_READ)) {
      const clientIds = clients?.items.map((c) => c._id) ?? [];
      const propertyIds = properties?.items.map((p) => p._id) ?? [];
      if (clientIds.length || propertyIds.length) {
        matches = await Match.find({
          businessId: auth.businessId,
          status: { $ne: 'STALE' },
          $or: [{ clientId: { $in: clientIds } }, { propertyId: { $in: propertyIds } }],
        })
          .sort({ matchScore: -1 })
          .limit(limit)
          .populate(scopedPopulate('clientId', 'fullName'))
          .populate(scopedPopulate('propertyId', 'propertyId society area askingPrice'))
          .lean();
      }
    }
    return {
      clients: want('clients') ? clients?.items ?? [] : [],
      properties: want('properties') ? properties?.items ?? [] : [],
      owners: owners?.items ?? [],
      matches,
    };
  },
};
