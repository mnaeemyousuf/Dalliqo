import { Schema, model, type Types } from 'mongoose';
import { BILLING_CYCLES, PLAN_KEYS, SUBSCRIPTION_STATUSES, SIZE_UNITS, type BillingCycle, type PlanKey, type SizeUnit, type SubscriptionStatus } from '@recrm/shared';

export const BUSINESS_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;

export const BILLING_EVENT_TYPES = ['TRIAL_STARTED', 'UPGRADE_REQUESTED', 'PLAN_CHANGED', 'PAYMENT_RECORDED', 'CANCELLED'] as const;

export interface BillingEvent {
  _id: Types.ObjectId;
  type: (typeof BILLING_EVENT_TYPES)[number];
  plan: PlanKey;
  cycle?: BillingCycle | null;
  amount?: number | null;
  reference?: string | null;
  note?: string | null;
  periodEnd?: Date | null;
  by?: Types.ObjectId | null;
  at: Date;
}

export interface SubscriptionDoc {
  plan: PlanKey;
  status: SubscriptionStatus;
  cycle?: BillingCycle | null;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  history: BillingEvent[];
}

/** The tenant. Its _id is the businessId stamped on every tenant document. */
export interface BusinessDoc {
  _id: Types.ObjectId;
  name: string;
  ownerUserId: Types.ObjectId;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country: string;
  currency: string;
  timezone: string;
  defaultSizeUnit: SizeUnit;
  status: (typeof BUSINESS_STATUSES)[number];
  subscription?: SubscriptionDoc;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const businessSchema = new Schema<BusinessDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true, maxlength: 500 },
    city: { type: String, trim: true, maxlength: 100 },
    country: { type: String, default: 'PK', maxlength: 2 },
    currency: { type: String, default: 'PKR', maxlength: 3 },
    timezone: { type: String, default: 'Asia/Karachi' },
    defaultSizeUnit: { type: String, enum: SIZE_UNITS, default: 'SQ_YARD' },
    status: { type: String, enum: BUSINESS_STATUSES, default: 'ACTIVE' },
    // Businesses created before plans existed have no subscription and are treated as ENTERPRISE/ACTIVE
    // (migration 004 writes that explicitly).
    subscription: {
      plan: { type: String, enum: PLAN_KEYS },
      status: { type: String, enum: SUBSCRIPTION_STATUSES },
      cycle: { type: String, enum: [...BILLING_CYCLES, null], default: null },
      trialEndsAt: { type: Date, default: null },
      currentPeriodEnd: { type: Date, default: null },
      history: {
        type: [
          {
            type: { type: String, enum: BILLING_EVENT_TYPES, required: true },
            plan: { type: String, enum: PLAN_KEYS, required: true },
            cycle: { type: String, enum: [...BILLING_CYCLES, null], default: null },
            amount: { type: Number, default: null },
            reference: { type: String, maxlength: 120, default: null },
            note: { type: String, maxlength: 500, default: null },
            periodEnd: { type: Date, default: null },
            by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            at: { type: Date, required: true },
          },
        ],
        default: [],
      },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

businessSchema.index({ ownerUserId: 1 });

export const Business = model<BusinessDoc>('Business', businessSchema);
