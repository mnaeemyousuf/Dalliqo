import { Schema, model, type Types } from 'mongoose';
import { SIZE_UNITS, type SizeUnit } from '@recrm/shared';

export const BUSINESS_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;

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
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

businessSchema.index({ ownerUserId: 1 });

export const Business = model<BusinessDoc>('Business', businessSchema);
