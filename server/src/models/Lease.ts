import { randomUUID } from 'node:crypto';
import { Schema, model, type Types } from 'mongoose';
import {
  DEPOSIT_STATUSES,
  INSPECTION_TYPES,
  LATE_FEE_TYPES,
  LEASE_STATUSES,
  PAYMENT_METHODS,
  PROPERTY_CONDITIONS,
  RENT_ITEM_STATUSES,
  type DepositStatus,
  type InspectionType,
  type LateFeeType,
  type LeaseStatus,
  type PaymentMethod,
  type RentItemStatus,
} from '@recrm/shared';
import { branchField, branchIndexes, tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

export interface RentItemDoc {
  _id: string;
  period: string;
  dueDate: Date;
  amount: number;
  lateFee: number;
  paid: number;
  status: RentItemStatus;
  waivedReason?: string | null;
}

export interface RentPaymentDoc {
  _id: string;
  date: Date;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  notes?: string | null;
  allocations: { itemId: string; amount: number }[];
  /** Management-fee income recorded for this payment, if any. */
  transactionId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
}

export interface InspectionDoc {
  _id: string;
  date: Date;
  type: InspectionType;
  condition: (typeof PROPERTY_CONDITIONS)[number];
  notes?: string | null;
  by: Types.ObjectId;
}

/** A rental lease: landlord (owner) lets a property to a tenant (client) with a monthly rent schedule. */
export interface LeaseDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  leaseNo: string;
  propertyId: Types.ObjectId;
  landlordId?: Types.ObjectId | null;
  tenantId: Types.ObjectId;
  agreementId?: Types.ObjectId | null;
  managerId?: Types.ObjectId | null;
  status: LeaseStatus;
  startDate: Date;
  endDate: Date;
  monthlyRent: number;
  dueDay: number;
  escalationPct: number;
  graceDays: number;
  lateFeeType: LateFeeType;
  lateFeeValue: number;
  securityDeposit: number;
  depositStatus: DepositStatus;
  depositRefunded: number;
  /** Percent of each rent payment the agency keeps as its fee (recorded as income). */
  managementFeePct: number;
  credit: number;
  schedule: RentItemDoc[];
  payments: RentPaymentDoc[];
  inspections: InspectionDoc[];
  endedAt?: Date | null;
  endReason?: string | null;
  notes?: string;
  // Denormalised for lists, filters and reports.
  outstanding: number;
  overdueAmount: number;
  nextDueDate?: Date | null;
  searchText: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const id = { type: String, default: () => randomUUID() };

const schema = new Schema<LeaseDoc>(
  {
    ...tenantFields,
    ...syncFields,
    ...branchField,
    leaseNo: { type: String, required: true, immutable: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    landlordId: { type: Schema.Types.ObjectId, ref: 'PropertyOwner', default: null },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    agreementId: { type: Schema.Types.ObjectId, ref: 'Agreement', default: null },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: LEASE_STATUSES, default: 'ACTIVE' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    monthlyRent: { type: Number, required: true, min: 1 },
    dueDay: { type: Number, default: 1, min: 1, max: 28 },
    escalationPct: { type: Number, default: 0, min: 0, max: 100 },
    graceDays: { type: Number, default: 5, min: 0, max: 60 },
    lateFeeType: { type: String, enum: LATE_FEE_TYPES, default: 'NONE' },
    lateFeeValue: { type: Number, default: 0, min: 0 },
    securityDeposit: { type: Number, default: 0, min: 0 },
    depositStatus: { type: String, enum: DEPOSIT_STATUSES, default: 'HELD' },
    depositRefunded: { type: Number, default: 0, min: 0 },
    managementFeePct: { type: Number, default: 0, min: 0, max: 100 },
    credit: { type: Number, default: 0, min: 0 },
    schedule: {
      type: [
        {
          _id: id,
          period: { type: String, required: true },
          dueDate: { type: Date, required: true },
          amount: { type: Number, required: true, min: 0 },
          lateFee: { type: Number, default: 0, min: 0 },
          paid: { type: Number, default: 0, min: 0 },
          status: { type: String, enum: RENT_ITEM_STATUSES, default: 'PENDING' },
          waivedReason: { type: String, default: null },
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
          transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
          createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
        },
      ],
      default: [],
    },
    inspections: {
      type: [
        {
          _id: id,
          date: { type: Date, required: true },
          type: { type: String, enum: INSPECTION_TYPES, required: true },
          condition: { type: String, enum: PROPERTY_CONDITIONS, required: true },
          notes: { type: String, maxlength: 2000, default: null },
          by: { type: Schema.Types.ObjectId, ref: 'User' },
        },
      ],
      default: [],
    },
    endedAt: { type: Date, default: null },
    endReason: { type: String, maxlength: 500, default: null },
    notes: { type: String, maxlength: 2000 },
    outstanding: { type: Number, default: 0 },
    overdueAmount: { type: Number, default: 0 },
    nextDueDate: { type: Date, default: null },
    searchText: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
branchIndexes(schema);
schema.index({ businessId: 1, leaseNo: 1 }, { unique: true });
schema.index({ businessId: 1, deletedAt: 1, status: 1, nextDueDate: 1 });
schema.index({ businessId: 1, propertyId: 1 });
schema.index({ businessId: 1, tenantId: 1 });
schema.index({ businessId: 1, landlordId: 1 });
schema.index({ businessId: 1, status: 1, endDate: 1 });
schema.index({ businessId: 1, 'schedule.dueDate': 1, 'schedule.status': 1 });
schema.plugin(tenantGuardPlugin);

export const Lease = model<LeaseDoc>('Lease', schema, 'leases');
