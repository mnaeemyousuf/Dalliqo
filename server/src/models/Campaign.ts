import { Schema, model, type Types } from 'mongoose';
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, type CampaignChannel, type CampaignStatus } from '@recrm/shared';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';

/** A marketing campaign; leads point at it (Client.campaignId) so its return on spend can be measured. */
export interface CampaignDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  /** Short code used in website links (?c=code) to attribute inquiries. */
  code: string;
  startDate?: Date | null;
  endDate?: Date | null;
  budget: number;
  spend: number;
  notes?: string | null;
  deletedAt?: Date | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<CampaignDoc>(
  {
    ...tenantFields,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    channel: { type: String, enum: CAMPAIGN_CHANNELS, required: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'ACTIVE' },
    code: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    budget: { type: Number, default: 0, min: 0 },
    spend: { type: Number, default: 0, min: 0 },
    notes: { type: String, maxlength: 2000, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

schema.index({ businessId: 1, code: 1 }, { unique: true });
schema.index({ businessId: 1, deletedAt: 1, status: 1 });
schema.plugin(tenantGuardPlugin);

export const Campaign = model<CampaignDoc>('Campaign', schema, 'campaigns');
