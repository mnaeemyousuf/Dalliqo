import { Schema, model, type Types } from 'mongoose';
import { MATCH_STATUSES, type MatchBand, type MatchReasonCode, type MatchStatus } from '@recrm/shared';
import { tenantGuardPlugin } from './plugins/tenant';

export interface MatchReason {
  code: MatchReasonCode;
  params?: Record<string, string | number>;
}

export interface MatchDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  clientId: Types.ObjectId;
  requirementId: Types.ObjectId;
  propertyId: Types.ObjectId;
  matchScore: number;
  band: MatchBand;
  breakdown: { type: number; location: number; budget: number; size: number; purpose: number };
  matchReasons: MatchReason[];
  status: MatchStatus;
  notified: boolean;
  algorithmVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<MatchDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, immutable: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    requirementId: { type: Schema.Types.ObjectId, required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    matchScore: { type: Number, required: true, min: 0, max: 100 },
    band: { type: String, required: true },
    breakdown: {
      type: { type: Number, default: 0 },
      location: { type: Number, default: 0 },
      budget: { type: Number, default: 0 },
      size: { type: Number, default: 0 },
      purpose: { type: Number, default: 0 },
    },
    matchReasons: { type: [{ _id: false, code: String, params: Schema.Types.Mixed }], default: [] },
    status: { type: String, enum: MATCH_STATUSES, default: 'NEW' },
    notified: { type: Boolean, default: false },
    algorithmVersion: { type: Number, default: 1 },
  },
  { timestamps: true, versionKey: false },
);

schema.index({ businessId: 1, requirementId: 1, propertyId: 1 }, { unique: true });
schema.index({ businessId: 1, clientId: 1, matchScore: -1 });
schema.index({ businessId: 1, propertyId: 1, matchScore: -1 });
schema.index({ businessId: 1, status: 1, matchScore: -1 });
schema.index({ businessId: 1, createdAt: -1 });
schema.index({ businessId: 1, updatedAt: 1, _id: 1 });
schema.plugin(tenantGuardPlugin);

export const Match = model<MatchDoc>('Match', schema, 'matches');
