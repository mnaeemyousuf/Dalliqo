import type { ClientSession } from 'mongoose';
import { DEFAULT_MATCHING_SETTINGS, DEFAULT_SQFT_PER_UNIT, ERROR_CODES, type MatchingSettings, type SizeUnit } from '@recrm/shared';
import { Settings, type SettingsDoc } from '../models/Settings';
import type { AuthContext, TenantContext } from '../types/context';
import { badRequest } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { auditService } from './auditService';

export interface EffectiveSettings {
  matching: MatchingSettings;
  sqftPerUnit: Record<SizeUnit, number>;
  reminders: { defaultMinutesBefore: number };
}

function effective(doc: Partial<SettingsDoc> | null): EffectiveSettings {
  return {
    matching: {
      weights: { ...DEFAULT_MATCHING_SETTINGS.weights, ...(doc?.matching?.weights ?? {}) },
      storeThreshold: doc?.matching?.storeThreshold ?? DEFAULT_MATCHING_SETTINGS.storeThreshold,
      notifyThreshold: doc?.matching?.notifyThreshold ?? DEFAULT_MATCHING_SETTINGS.notifyThreshold,
    },
    sqftPerUnit: { ...DEFAULT_SQFT_PER_UNIT, ...(doc?.sqftPerUnit ?? {}) },
    reminders: { defaultMinutesBefore: doc?.reminders?.defaultMinutesBefore ?? 30 },
  };
}

export type SettingsUpdate = {
  matching?: { weights?: Partial<MatchingSettings['weights']>; storeThreshold?: number; notifyThreshold?: number };
  sqftPerUnit?: Partial<Record<SizeUnit, number>>;
  reminders?: { defaultMinutesBefore?: number };
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
      },
      sqftPerUnit: { ...before.sqftPerUnit, ...(input.sqftPerUnit ?? {}) },
      reminders: { defaultMinutesBefore: input.reminders?.defaultMinutesBefore ?? before.reminders.defaultMinutesBefore },
    };
    const w = next.matching.weights;
    const total = w.type + w.location + w.budget + w.size + w.purpose;
    if (total !== 100) throw badRequest(ERROR_CODES.VALIDATION_ERROR, `Matching weights must add up to 100 (currently ${total})`);
    if (next.matching.notifyThreshold < next.matching.storeThreshold) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Notify threshold cannot be lower than the store threshold');
    }
    await Settings.findOneAndUpdate({ businessId: auth.businessId }, { $set: { ...next, updatedBy: auth.userId } }, { upsert: true, new: true });
    const changes = diffFields(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, ['matching', 'sqftPerUnit', 'reminders']);
    if (changes.length) await auditService.record(auth, { action: 'settings.updated', entityType: 'settings', changes, ip });
    return next;
  },
};
