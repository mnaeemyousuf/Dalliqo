import { Schema, model, type Types } from 'mongoose';
import { TRANSACTION_TYPES, type TransactionType } from '@recrm/shared';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

/** Income / expense category. Built-ins (with Urdu names) are seeded per business; owners add their own. */
export interface TransactionCategoryDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  key?: string;
  name: string;
  nameUr?: string;
  type: TransactionType;
  isSystem: boolean;
  sortOrder: number;
  archivedAt?: Date | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<TransactionCategoryDoc>(
  {
    ...tenantFields,
    ...syncFields,
    key: { type: String },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameUr: { type: String, trim: true, maxlength: 80 },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    isSystem: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 100 },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
schema.index({ businessId: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: 'string' } } });
schema.index({ businessId: 1, type: 1, sortOrder: 1 });
schema.plugin(tenantGuardPlugin);

export const TransactionCategory = model<TransactionCategoryDoc>('TransactionCategory', schema, 'transactionCategories');
