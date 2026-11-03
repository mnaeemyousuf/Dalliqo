import { Schema, model, type Types } from 'mongoose';
import { PAYMENT_METHODS, TRANSACTION_SOURCES, TRANSACTION_TYPES, type PaymentMethod, type TransactionSource, type TransactionType } from '@recrm/shared';
import { branchField, branchIndexes, tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

/**
 * Income / expense entry. Commission received on a deal creates its income entry automatically
 * (source COMMISSION, sourceKey = deal:<id>:payment:<paymentId>, unique — never duplicated).
 */
export interface TransactionDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  type: TransactionType;
  categoryId: Types.ObjectId;
  amount: number;
  date: Date;
  method: PaymentMethod;
  dealId?: Types.ObjectId | null;
  propertyId?: Types.ObjectId | null;
  clientId?: Types.ObjectId | null;
  description?: string;
  reference?: string;
  source: TransactionSource;
  sourceKey?: string | null;
  searchText: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<TransactionDoc>(
  {
    ...tenantFields,
    ...syncFields,
    ...branchField,
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'TransactionCategory', required: true },
    amount: { type: Number, required: true, min: 1 },
    date: { type: Date, required: true },
    method: { type: String, enum: PAYMENT_METHODS, default: 'CASH' },
    dealId: { type: Schema.Types.ObjectId, ref: 'Deal', default: null },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    description: { type: String, maxlength: 500 },
    reference: { type: String, maxlength: 100 },
    source: { type: String, enum: TRANSACTION_SOURCES, default: 'MANUAL' },
    sourceKey: { type: String, default: null },
    searchText: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
branchIndexes(schema);
schema.index({ businessId: 1, deletedAt: 1, date: -1 });
schema.index({ businessId: 1, type: 1, date: -1 });
schema.index({ businessId: 1, categoryId: 1, date: -1 });
schema.index({ businessId: 1, dealId: 1 });
// One income entry per commission payment, even if the hook runs twice.
schema.index({ businessId: 1, sourceKey: 1 }, { unique: true, partialFilterExpression: { sourceKey: { $type: 'string' } } });
schema.plugin(tenantGuardPlugin);

export const Transaction = model<TransactionDoc>('Transaction', schema, 'transactions');
