import type { ClientSession } from 'mongoose';
import {
  AUTOMATION_RULES,
  AUTOMATION_RULE_KEYS,
  DEFAULT_AUTOMATION_SETTINGS,
  DEFAULT_LEAD_SCORING,
  DEFAULT_MATCHING_SETTINGS,
  DEFAULT_SQFT_PER_UNIT,
  ERROR_CODES,
  type AutomationRuleKey,
  type AutomationSettings,
  type LeadScoringSettings,
  type MatchingSettings,
  type SizeUnit,
  DEFAULT_COMMISSION_SETTINGS,
  type CommissionDefaults,
} from '@recrm/shared';
import { Settings, type SettingsDoc } from '../models/Settings';
import type { AuthContext, TenantContext } from '../types/context';
import { badRequest } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { auditService } from './auditService';

export interface EffectiveSettings {
  matching: MatchingSettings;
  sqftPerUnit: Record<SizeUnit, number>;
  reminders: { defaultMinutesBefore: number };
  commission: CommissionDefaults;
  leadScoring: LeadScoringSettings;
  automation: AutomationSettings;
}

function effectiveAutomation(stored?: Partial<AutomationSettings> | null): AutomationSettings {
  const out = {} as AutomationSettings;
  for (const k of AUTOMATION_RULE_KEYS) {
    const s = (stored?.[k] ?? {}) as Partial<AutomationSettings[AutomationRuleKey]>;
    out[k] = { enabled: s.enabled ?? DEFAULT_AUTOMATION_SETTINGS[k].enabled, threshold: s.threshold ?? DEFAULT_AUTOMATION_SETTINGS[k].threshold };
  }
  return out;
}

function effective(doc: Partial<SettingsDoc> | null): EffectiveSettings {
  return {
    matching: {
      weights: { ...DEFAULT_MATCHING_SETTINGS.weights, ...(doc?.matching?.weights ?? {}) },
      storeThreshold: doc?.matching?.storeThreshold ?? DEFAULT_MATCHING_SETTINGS.storeThreshold,
      notifyThreshold: doc?.matching?.notifyThreshold ?? DEFAULT_MATCHING_SETTINGS.notifyThreshold,
      crossBranch: doc?.matching?.crossBranch ?? DEFAULT_MATCHING_SETTINGS.crossBranch,
    },
    sqftPerUnit: { ...DEFAULT_SQFT_PER_UNIT, ...(doc?.sqftPerUnit ?? {}) },
    reminders: { defaultMinutesBefore: doc?.reminders?.defaultMinutesBefore ?? 30 },
    commission: { ...DEFAULT_COMMISSION_SETTINGS, ...(doc?.commission ?? {}) },
    leadScoring: {
      weights: { ...DEFAULT_LEAD_SCORING.weights, ...stripUndefined(doc?.leadScoring?.weights ?? {}) },
      hotThreshold: doc?.leadScoring?.hotThreshold ?? DEFAULT_LEAD_SCORING.hotThreshold,
      warmThreshold: doc?.leadScoring?.warmThreshold ?? DEFAULT_LEAD_SCORING.warmThreshold,
    },
    automation: effectiveAutomation(doc?.automation),
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

export type SettingsUpdate = {
  matching?: { weights?: Partial<MatchingSettings['weights']>; storeThreshold?: number; notifyThreshold?: number; crossBranch?: boolean };
  sqftPerUnit?: Partial<Record<SizeUnit, number>>;
  reminders?: { defaultMinutesBefore?: number };
  commission?: Partial<CommissionDefaults>;
  leadScoring?: { weights?: Partial<LeadScoringSettings['weights']>; hotThreshold?: number; warmThreshold?: number };
  automation?: Partial<Record<AutomationRuleKey, { enabled?: boolean; threshold?: number }>>;
};

export const settingsService = {
  async createDefaults(ctx: TenantContext, session?: ClientSession): Promise<void> {
    await Settings.create([{ businessId: ctx.businessId, updatedBy: ctx.userId }], { session });
  },

  async get(ctx: TenantContext): Promise<EffectiveSettings> {
    return effective(await Settings.findOne({ businessId: ctx.businessId }).lean<SettingsDoc>());
  },

  toSqft(settings: EffectiveSettings, size: number | undefined | null, unit: SizeUnit | undefined | null): number | undefined {
    if (size === undefined || size === null || !unit) return undefined;
    return Math.round(size * settings.sqftPerUnit[unit] * 100) / 100;
  },

  async update(auth: AuthContext, input: SettingsUpdate, ip?: string): Promise<EffectiveSettings> {
    const before = await this.get(auth);
    const next: EffectiveSettings = {
      matching: {
        weights: { ...before.matching.weights, ...(input.matching?.weights ?? {}) },
        storeThreshold: input.matching?.storeThreshold ?? before.matching.storeThreshold,
        notifyThreshold: input.matching?.notifyThreshold ?? before.matching.notifyThreshold,
        crossBranch: input.matching?.crossBranch ?? before.matching.crossBranch,
      },
      sqftPerUnit: { ...before.sqftPerUnit, ...(input.sqftPerUnit ?? {}) },
      reminders: { defaultMinutesBefore: input.reminders?.defaultMinutesBefore ?? before.reminders.defaultMinutesBefore },
      commission: { ...before.commission, ...(input.commission ?? {}) },
      leadScoring: {
        weights: { ...before.leadScoring.weights, ...stripUndefined(input.leadScoring?.weights ?? {}) },
        hotThreshold: input.leadScoring?.hotThreshold ?? before.leadScoring.hotThreshold,
        warmThreshold: input.leadScoring?.warmThreshold ?? before.leadScoring.warmThreshold,
      },
      automation: effectiveAutomation(
        Object.fromEntries(AUTOMATION_RULE_KEYS.map((k) => [k, { ...before.automation[k], ...stripUndefined(input.automation?.[k] ?? {}) }])) as AutomationSettings,
      ),
    };
    if (next.leadScoring.warmThreshold >= next.leadScoring.hotThreshold) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The warm threshold must be below the hot threshold');
    }
    if (!Object.values(next.leadScoring.weights).some((w) => w > 0)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'At least one lead-scoring weight must be above zero');
    for (const k of AUTOMATION_RULE_KEYS) {
      const def = AUTOMATION_RULES[k];
      const th = next.automation[k].threshold;
      if (th < def.min || th > def.max) throw badRequest(ERROR_CODES.VALIDATION_ERROR, `${k}: threshold must be between ${def.min} and ${def.max} ${def.unit}`);
    }
    const w = next.matching.weights;
    const total = w.type + w.location + w.budget + w.size + w.purpose;
    if (total !== 100) throw badRequest(ERROR_CODES.VALIDATION_ERROR, `Matching weights must add up to 100 (currently ${total})`);
    if (next.matching.notifyThreshold < next.matching.storeThreshold) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Notify threshold cannot be lower than the store threshold');
    }
    await Settings.findOneAndUpdate({ businessId: auth.businessId }, { $set: { ...next, updatedBy: auth.userId } }, { upsert: true, new: true });
    const changes = diffFields(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, ['matching', 'sqftPerUnit', 'reminders', 'commission', 'leadScoring', 'automation']);
    if (changes.length) await auditService.record(auth, { action: 'settings.updated', entityType: 'settings', changes, ip });
    return next;
  },
};
