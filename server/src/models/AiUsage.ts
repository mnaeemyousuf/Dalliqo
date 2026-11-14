import { Schema, model, type Types } from 'mongoose';
import { AI_FEATURES, type AiFeature } from '@recrm/shared';

/** One AI provider call — for the monthly allowance, cost visibility and auditing. */
export interface AiUsageDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  userId: Types.ObjectId;
  feature: AiFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  outcome: 'OK' | 'REFUSED' | 'ERROR';
  createdAt: Date;
}

const schema = new Schema<AiUsageDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    feature: { type: String, enum: AI_FEATURES, required: true },
    model: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    outcome: { type: String, enum: ['OK', 'REFUSED', 'ERROR'], default: 'OK' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

schema.index({ businessId: 1, createdAt: -1 });
// Usage rows are kept a year.
schema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 86_400 });

export const AiUsage = model<AiUsageDoc>('AiUsage', schema, 'aiUsage');
