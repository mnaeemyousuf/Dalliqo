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
  /** Marketing expense booked against a campaign (counts toward its spend / ROI). */
  campaignId?: Types.ObjectId | null;
  /** Maintenance or other cost on a managed rental (shows on the lease and the landlord statement). */
  leaseId?: Types.ObjectId | null;
  /** A refund (EXPENSE) points at the income it returns money from. */
  refundOf?: Types.ObjectId | null;
  /** On an income entry: how much has been refunded so far (the entry itself is never edited down). */
  refundedAmount?: number;
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
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    leaseId: { type: Schema.Types.ObjectId, ref: 'Lease', default: null },
    refundOf: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    refundedAmount: { type: Number, default: 0, min: 0 },
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
schema.index({ businessId: 1, leaseId: 1 }, { partialFilterExpression: { leaseId: { $type: 'objectId' } } });
schema.index({ businessId: 1, refundOf: 1 }, { partialFilterExpression: { refundOf: { $type: 'objectId' } } });
schema.index({ businessId: 1, campaignId: 1 }, { partialFilterExpression: { campaignId: { $type: 'objectId' } } });
// One income entry per commission payment, even if the hook runs twice.
schema.index({ businessId: 1, sourceKey: 1 }, { unique: true, partialFilterExpression: { sourceKey: { $type: 'string' } } });
schema.plugin(tenantGuardPlugin);

export const Transaction = model<TransactionDoc>('Transaction', schema, 'transactions');
