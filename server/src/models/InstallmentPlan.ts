import { randomUUID } from 'node:crypto';
import { Schema, model, type Types } from 'mongoose';
import {
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_KINDS,
  INSTALLMENT_PLAN_STATUSES,
  PAYMENT_METHODS,
  RENT_ITEM_STATUSES,
  type InstallmentFrequency,
  type InstallmentKind,
  type InstallmentPlanStatus,
  type PaymentMethod,
  type RentItemStatus,
} from '@recrm/shared';
import { branchField, branchIndexes, tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

export interface InstallmentItemDoc {
  _id: string;
  kind: InstallmentKind;
  label: string;
  dueDate: Date;
  amount: number;
  /** Kept at 0 — present so rental helpers (balance, status, allocation) apply unchanged. */
  lateFee: number;
  paid: number;
  status: RentItemStatus;
}

/** A buyer's payment plan for a property (booking, down payment, installments, possession). */
export interface InstallmentPlanDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  planNo: string;
  dealId?: Types.ObjectId | null;
  clientId: Types.ObjectId;
  propertyId?: Types.ObjectId | null;
  title?: string;
  status: InstallmentPlanStatus;
  totalAmount: number;
  frequency: InstallmentFrequency;
  graceDays: number;
  items: InstallmentItemDoc[];
  payments: { _id: string; date: Date; amount: number; method: PaymentMethod; reference?: string | null; notes?: string | null; allocations: { itemId: string; amount: number }[]; createdBy: Types.ObjectId }[];
  credit: number;
  outstanding: number;
  overdueAmount: number;
  paidTotal: number;
  nextDueDate?: Date | null;
  cancelReason?: string | null;
  notes?: string;
  searchText: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const id = { type: String, default: () => randomUUID() };

const schema = new Schema<InstallmentPlanDoc>(
  {
    ...tenantFields,
    ...syncFields,
    ...branchField,
    planNo: { type: String, required: true, immutable: true },
    dealId: { type: Schema.Types.ObjectId, ref: 'Deal', default: null },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    title: { type: String, maxlength: 150 },
    status: { type: String, enum: INSTALLMENT_PLAN_STATUSES, default: 'ACTIVE' },
    totalAmount: { type: Number, required: true, min: 1 },
    frequency: { type: String, enum: INSTALLMENT_FREQUENCIES, default: 'MONTHLY' },
    graceDays: { type: Number, default: 7, min: 0, max: 90 },
    items: {
      type: [
        {
          _id: id,
          kind: { type: String, enum: INSTALLMENT_KINDS, default: 'INSTALLMENT' },
          label: { type: String, maxlength: 80 },
          dueDate: { type: Date, required: true },
          amount: { type: Number, required: true, min: 0 },
          lateFee: { type: Number, default: 0 },
          paid: { type: Number, default: 0, min: 0 },
          status: { type: String, enum: RENT_ITEM_STATUSES, default: 'PENDING' },
        },
      ],
      default: [],
    },
    payments: {
      type: [
        {
          _id: id,
          date: { type: Date, required: true },
          amount: { type: Number, required: true, min: 1 },
          method: { type: String, enum: PAYMENT_METHODS, default: 'CASH' },
          reference: { type: String, maxlength: 100, default: null },
          notes: { type: String, maxlength: 500, default: null },
          allocations: { type: [{ _id: false, itemId: String, amount: Number }], default: [] },
          createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
        },
      ],
      default: [],
    },
    credit: { type: Number, default: 0, min: 0 },
    outstanding: { type: Number, default: 0 },
    overdueAmount: { type: Number, default: 0 },
    paidTotal: { type: Number, default: 0 },
    nextDueDate: { type: Date, default: null },
    cancelReason: { type: String, maxlength: 500, default: null },
    notes: { type: String, maxlength: 2000 },
    searchText: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
branchIndexes(schema);
schema.index({ businessId: 1, planNo: 1 }, { unique: true });
schema.index({ businessId: 1, deletedAt: 1, status: 1, nextDueDate: 1 });
schema.index({ businessId: 1, clientId: 1 });
schema.index({ businessId: 1, dealId: 1 });
schema.index({ businessId: 1, 'items.dueDate': 1, 'items.status': 1 });
schema.plugin(tenantGuardPlugin);

export const InstallmentPlan = model<InstallmentPlanDoc>('InstallmentPlan', schema, 'installmentPlans');
