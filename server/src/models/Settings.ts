import { Schema, model, type Types } from 'mongoose';
import { DEFAULT_MATCHING_SETTINGS, DEFAULT_SQFT_PER_UNIT, type MatchingSettings, type SizeUnit } from '@recrm/shared';
import { tenantGuardPlugin } from './plugins/tenant';

/** One document per business. Missing values fall back to the defaults. */
export interface SettingsDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  matching: MatchingSettings;
  sqftPerUnit: Record<SizeUnit, number>;
  reminders: { defaultMinutesBefore: number };
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<SettingsDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, immutable: true },
    matching: {
      weights: {
        type: { type: Number, default: DEFAULT_MATCHING_SETTINGS.weights.type },
        location: { type: Number, default: DEFAULT_MATCHING_SETTINGS.weights.location },
        budget: { type: Number, default: DEFAULT_MATCHING_SETTINGS.weights.budget },
        size: { type: Number, default: DEFAULT_MATCHING_SETTINGS.weights.size },
        purpose: { type: Number, default: DEFAULT_MATCHING_SETTINGS.weights.purpose },
      },
      storeThreshold: { type: Number, default: DEFAULT_MATCHING_SETTINGS.storeThreshold },
      notifyThreshold: { type: Number, default: DEFAULT_MATCHING_SETTINGS.notifyThreshold },
    },
    sqftPerUnit: {
      SQ_FT: { type: Number, default: DEFAULT_SQFT_PER_UNIT.SQ_FT },
      SQ_YARD: { type: Number, default: DEFAULT_SQFT_PER_UNIT.SQ_YARD },
      SQ_METER: { type: Number, default: DEFAULT_SQFT_PER_UNIT.SQ_METER },
      MARLA: { type: Number, default: DEFAULT_SQFT_PER_UNIT.MARLA },
      KANAL: { type: Number, default: DEFAULT_SQFT_PER_UNIT.KANAL },
    },
    reminders: { defaultMinutesBefore: { type: Number, default: 30 } },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, versionKey: false },
);

schema.index({ businessId: 1 }, { unique: true });
schema.plugin(tenantGuardPlugin);

export const Settings = model<SettingsDoc>('Settings', schema, 'settings');
