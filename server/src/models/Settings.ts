import { Schema, model, type Types } from 'mongoose';
import {
  AUTOMATION_RULE_KEYS,
  DEFAULT_COMMISSION_SETTINGS,
  DEFAULT_LEAD_SCORING,
  DEFAULT_MATCHING_SETTINGS,
  DEFAULT_SQFT_PER_UNIT,
  LEAD_SCORE_FACTORS,
  type AutomationSettings,
  type CommissionDefaults,
  type LeadScoringSettings,
  type MatchingSettings,
  type SizeUnit,
} from '@recrm/shared';
import { tenantGuardPlugin } from './plugins/tenant';
import { DEAL_STAGES, type DealStageConfig, type LeadAssignmentSettings } from '@recrm/shared';

/** One document per business. Missing values fall back to the defaults. */
export interface SettingsDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  matching: MatchingSettings;
  sqftPerUnit: Record<SizeUnit, number>;
  reminders: { defaultMinutesBefore: number };
  commission: CommissionDefaults;
  leadScoring?: Partial<LeadScoringSettings>;
  automation?: Partial<AutomationSettings>;
  leadAssignment?: Partial<LeadAssignmentSettings> & { cursor?: number };
  dealPipeline?: { stages?: Partial<DealStageConfig>[] };
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
        features: { type: Number, default: DEFAULT_MATCHING_SETTINGS.weights.features },
      },
      storeThreshold: { type: Number, default: DEFAULT_MATCHING_SETTINGS.storeThreshold },
      notifyThreshold: { type: Number, default: DEFAULT_MATCHING_SETTINGS.notifyThreshold },
      /** Match clients with properties of other branches too (default: same branch only). */
      crossBranch: { type: Boolean, default: false },
    },
    sqftPerUnit: {
      SQ_FT: { type: Number, default: DEFAULT_SQFT_PER_UNIT.SQ_FT },
      SQ_YARD: { type: Number, default: DEFAULT_SQFT_PER_UNIT.SQ_YARD },
      SQ_METER: { type: Number, default: DEFAULT_SQFT_PER_UNIT.SQ_METER },
      MARLA: { type: Number, default: DEFAULT_SQFT_PER_UNIT.MARLA },
      KANAL: { type: Number, default: DEFAULT_SQFT_PER_UNIT.KANAL },
      ACRE: { type: Number, default: DEFAULT_SQFT_PER_UNIT.ACRE },
    },
    reminders: { defaultMinutesBefore: { type: Number, default: 30 } },
    commission: {
      defaultBuyerPct: { type: Number, default: DEFAULT_COMMISSION_SETTINGS.defaultBuyerPct },
      defaultSellerPct: { type: Number, default: DEFAULT_COMMISSION_SETTINGS.defaultSellerPct },
      autoCreateIncome: { type: Boolean, default: DEFAULT_COMMISSION_SETTINGS.autoCreateIncome },
      closeApprovalRequired: { type: Boolean, default: DEFAULT_COMMISSION_SETTINGS.closeApprovalRequired },
      payoutApprovalRequired: { type: Boolean, default: DEFAULT_COMMISSION_SETTINGS.payoutApprovalRequired },
    },
    leadAssignment: {
      mode: { type: String, enum: ['NONE', 'ROUND_ROBIN', 'BY_SOURCE'], default: 'NONE' },
      preferListingAgent: { type: Boolean, default: true },
      agentIds: { type: [String], default: [] },
      bySource: { type: [{ _id: false, source: String, userId: String }], default: [] },
      /** Round-robin position (internal). */
      cursor: { type: Number, default: 0 },
    },
    // Missing stages fall back to DEFAULT_DEAL_PIPELINE (see normalizeDealPipeline).
    dealPipeline: {
      stages: { type: [{ _id: false, stage: { type: String, enum: DEAL_STAGES }, enabled: Boolean, label: String, labelUr: String, probability: Number }], default: undefined },
    },
    // Missing values fall back to DEFAULT_LEAD_SCORING / DEFAULT_AUTOMATION_SETTINGS (see settingsService).
    leadScoring: {
      weights: Object.fromEntries(LEAD_SCORE_FACTORS.map((f) => [f, { type: Number }])),
      hotThreshold: { type: Number, default: DEFAULT_LEAD_SCORING.hotThreshold },
      warmThreshold: { type: Number, default: DEFAULT_LEAD_SCORING.warmThreshold },
    },
    automation: Object.fromEntries(AUTOMATION_RULE_KEYS.map((k) => [k, { enabled: Boolean, threshold: Number }])),
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, versionKey: false },
);

schema.index({ businessId: 1 }, { unique: true });
schema.plugin(tenantGuardPlugin);

export const Settings = model<SettingsDoc>('Settings', schema, 'settings');
