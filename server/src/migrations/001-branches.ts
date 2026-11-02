import { Types, type Model } from 'mongoose';
import { Activity } from '../models/Activity';
import { Branch } from '../models/Branch';
import { Business } from '../models/Business';
import { BusinessMember } from '../models/BusinessMember';
import { Client } from '../models/Client';
import { Document, PropertyMedia } from '../models/FileAsset';
import { FollowUp } from '../models/FollowUp';
import { Match } from '../models/Match';
import { Note } from '../models/Note';
import { Property } from '../models/Property';
import { PropertyOwner } from '../models/PropertyOwner';

export interface BranchMigrationResult {
  businesses: number;
  branchesCreated: number;
  backfilled: Record<string, number>;
  membersUpdated: number;
}

/**
 * Multi-branch migration. For every business: create the default "Main Branch" if it has none,
 * put every existing record without a branch into it, and give every existing member access to
 * ALL branches — so nobody's access changes. Idempotent: a second run finds nothing to do.
 *
 * `updatedAt` is deliberately left unchanged (timestamps: false): records must not look edited and
 * list order must not change. Apps treat a record without branchId as belonging to the default
 * branch until it is next saved.
 */
export async function migrateBranches(): Promise<BranchMigrationResult> {
  const result: BranchMigrationResult = { businesses: 0, branchesCreated: 0, backfilled: {}, membersUpdated: 0 };
  const businesses = await Business.find({}).select('_id ownerUserId').lean();
  const noBranch = { $or: [{ branchId: { $exists: false } }, { branchId: null }] };
  const add = (k: string, n: number) => (result.backfilled[k] = (result.backfilled[k] ?? 0) + n);

  for (const b of businesses) {
    result.businesses++;
    const businessId = b._id;
    let def: { _id: unknown } | null = await Branch.findOne({ businessId, isDefault: true }).select('_id').lean<{ _id: unknown }>();
    if (!def) {
      try {
        const [created] = await Branch.create([{ businessId, name: 'Main Branch', nameUr: 'مرکزی برانچ', isDefault: true, createdBy: b.ownerUserId, updatedBy: b.ownerUserId }]);
        def = { _id: created._id };
        result.branchesCreated++;
      } catch {
        def = await Branch.findOne({ businessId, isDefault: true }).select('_id').lean<{ _id: unknown }>(); // created concurrently
      }
    }
    const branchId = def!._id as Types.ObjectId;

    const collections: [string, Model<never>][] = [
      ['clients', Client as never],
      ['owners', PropertyOwner as never],
      ['properties', Property as never],
      ['followUps', FollowUp as never],
      ['notes', Note as never],
      ['documents', Document as never],
      ['media', PropertyMedia as never],
    ];
    for (const [name, model] of collections) {
      const res = await model.updateMany({ businessId, ...noBranch } as never, { $set: { branchId } } as never, { timestamps: false });
      add(name, res.modifiedCount);
    }
    const matches = await Match.updateMany({ businessId, $or: [{ branchIds: { $exists: false } }, { branchIds: { $size: 0 } }] }, { $set: { branchIds: [branchId] } }, { timestamps: false });
    add('matches', matches.modifiedCount);
    // Timeline entries about records (they all lived in the one branch until now).
    const acts = await Activity.updateMany({ businessId, branchId: null, 'refs.0': { $exists: true } }, { $set: { branchId } });
    add('activities', acts.modifiedCount);

    const members = await BusinessMember.updateMany(
      { businessId, $or: [{ branchAccess: { $exists: false } }, { branchAccess: null }] },
      { $set: { branchAccess: 'ALL', branchIds: [] } },
      { timestamps: false },
    );
    result.membersUpdated += members.modifiedCount;
  }
  return result;
}
