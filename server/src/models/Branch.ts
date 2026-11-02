import { Schema, model, type Types } from 'mongoose';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

/**
 * An office of the business (multi-branch agencies). Every business has exactly one default
 * branch ("Main Branch"), created at registration or by the branches migration for existing
 * businesses. Clients, owners, properties, follow-ups, deals, agreements and transactions carry
 * a branchId; members see all branches or only the ones on their membership.
 */
export interface BranchDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  name: string;
  nameUr?: string;
  code?: string;
  address?: string;
  phone?: string;
  isDefault: boolean;
  archivedAt?: Date | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<BranchDoc>(
  {
    ...tenantFields,
    ...syncFields,
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameUr: { type: String, trim: true, maxlength: 80 },
    code: { type: String, trim: true, uppercase: true, maxlength: 12 },
    address: { type: String, trim: true, maxlength: 300 },
    phone: { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
schema.index({ businessId: 1, name: 1 });
// At most one default branch per business.
schema.index({ businessId: 1, isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });
schema.plugin(tenantGuardPlugin);

export const Branch = model<BranchDoc>('Branch', schema, 'branches');
