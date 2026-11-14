import { Schema, model, type Types } from 'mongoose';
import { INQUIRY_STATUSES, type InquiryStatus } from '@recrm/shared';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';

/** A message sent through the agency website (or another public channel) — kept as received. */
export interface InquiryDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  channel: 'WEBSITE' | 'WHATSAPP';
  propertyId?: Types.ObjectId | null;
  campaignId?: Types.ObjectId | null;
  clientId?: Types.ObjectId | null;
  /** True when the inquiry created a new lead (false = matched an existing client). */
  createdLead: boolean;
  name: string;
  phone: string;
  email?: string | null;
  message?: string | null;
  status: InquiryStatus;
  assignedTo?: Types.ObjectId | null;
  ipHash?: string | null;
  /** Provider message id (WhatsApp) so webhook retries are processed once. */
  externalId?: string | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<InquiryDoc>(
  {
    ...tenantFields,
    channel: { type: String, enum: ['WEBSITE', 'WHATSAPP'], default: 'WEBSITE' },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    createdLead: { type: Boolean, default: false },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: null },
    message: { type: String, trim: true, maxlength: 2000, default: null },
    status: { type: String, enum: INQUIRY_STATUSES, default: 'NEW' },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    ipHash: { type: String, default: null },
    externalId: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

schema.index({ businessId: 1, createdAt: -1 });
schema.index({ businessId: 1, status: 1, createdAt: -1 });
schema.index({ businessId: 1, propertyId: 1 });
schema.index({ businessId: 1, campaignId: 1 });
schema.index({ businessId: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });
schema.plugin(tenantGuardPlugin);

export const Inquiry = model<InquiryDoc>('Inquiry', schema, 'inquiries');
