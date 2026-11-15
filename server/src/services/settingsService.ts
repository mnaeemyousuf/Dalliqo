import type { ClientSession } from 'mongoose';
import { DEFAULT_RETENTION, MIN_RETENTION, type RetentionSettings } from '@recrm/shared';
import { DEFAULT_LEAD_ASSIGNMENT, REQUIRED_DEAL_STAGES, normalizeDealPipeline, type DealPipelineSettings, type DealStageConfig, type LeadAssignmentSettings } from '@recrm/shared';
import { memberRepository } from '../repositories/memberRepository';
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
  leadAssignment: LeadAssignmentSettings;
  dealPipeline: DealPipelineSettings;
  retention: RetentionSettings;
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
    leadAssignment: {
      mode: doc?.leadAssignment?.mode ?? DEFAULT_LEAD_ASSIGNMENT.mode,
      preferListingAgent: doc?.leadAssignment?.preferListingAgent ?? DEFAULT_LEAD_ASSIGNMENT.preferListingAgent,
      agentIds: doc?.leadAssignment?.agentIds ?? [],
      bySource: doc?.leadAssignment?.bySource ?? [],
    },
    dealPipeline: normalizeDealPipeline(doc?.dealPipeline),
    retention: { auditLogMonths: doc?.retention?.auditLogMonths ?? DEFAULT_RETENTION.auditLogMonths, activityMonths: doc?.retention?.activityMonths ?? DEFAULT_RETENTION.activityMonths },
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
  leadAssignment?: Partial<LeadAssignmentSettings>;
  retention?: Partial<RetentionSettings>;
  /** Changed stages only (matched by key); the rest keep their current configuration. */
  dealPipeline?: { stages: (Partial<DealStageConfig> & { stage: DealStageConfig['stage'] })[] };
};

export const settingsService = {
  async createDefaults(ctx: TenantContext, session?: ClientSession): Promise<void> {
    await Settings.create([{ businessId: ctx.businessId, updatedBy: ctx.userId }], { session });
  },

  /**
   * Next assignee for an incoming lead under the business's rules (null = leave unassigned).
   * Round-robin advances an atomic cursor, so parallel inquiries spread evenly.
   */
  async pickAssignee(ctx: TenantContext, source: string, isActive: (userId: string) => Promise<boolean>): Promise<string | null> {
    const s = (await this.get(ctx)).leadAssignment;
    if (s.mode === 'BY_SOURCE') {
      const rule = s.bySource.find((r) => r.source === source);
      if (rule && (await isActive(rule.userId))) return rule.userId;
    }
    if ((s.mode === 'ROUND_ROBIN' || s.mode === 'BY_SOURCE') && s.agentIds.length) {
      for (let tries = 0; tries < s.agentIds.length; tries++) {
        const doc = await Settings.findOneAndUpdate({ businessId: ctx.businessId }, { $inc: { 'leadAssignment.cursor': 1 } }, { new: true }).lean<SettingsDoc>();
        const i = ((doc?.leadAssignment?.cursor ?? 1) - 1) % s.agentIds.length;
        if (await isActive(s.agentIds[i])) return s.agentIds[i];
      }
    }
    return null;
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
      leadAssignment: { ...before.leadAssignment, ...stripUndefined(input.leadAssignment ?? {}) },
      dealPipeline: input.dealPipeline
        ? normalizeDealPipeline({ stages: before.dealPipeline.stages.map((s) => ({ ...s, ...stripUndefined(input.dealPipeline!.stages.find((c) => c.stage === s.stage) ?? {}) })) })
        : before.dealPipeline,
      retention: { ...before.retention, ...stripUndefined(input.retention ?? {}) },
    };
    for (const k of ['auditLogMonths', 'activityMonths'] as const) {
      const v = next.retention[k];
      if (v !== 0 && v < MIN_RETENTION[k]) {
        throw badRequest(ERROR_CODES.VALIDATION_ERROR, `Keep ${k === 'auditLogMonths' ? 'the audit log' : 'activity'} for at least ${MIN_RETENTION[k]} months, or forever (0)`);
      }
    }
    if (input.dealPipeline?.stages.some((c) => c.enabled === false && REQUIRED_DEAL_STAGES.includes(c.stage))) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Inquiry, Won and Lost are always part of the pipeline');
    }
    if (input.leadAssignment) {
      const ids = [...new Set([...next.leadAssignment.agentIds, ...next.leadAssignment.bySource.map((r) => r.userId)])];
      for (const uid of ids) {
        if (!(await memberRepository.isActiveMemberUser(auth, uid))) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Lead assignment can only use active members');
      }
      if (next.leadAssignment.mode === 'ROUND_ROBIN' && !next.leadAssignment.agentIds.length) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Choose at least one agent for round-robin');
    }
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
    const { leadAssignment, ...rest } = next;
    await Settings.findOneAndUpdate(
      { businessId: auth.businessId },
      { $set: { ...rest, 'leadAssignment.mode': leadAssignment.mode, 'leadAssignment.preferListingAgent': leadAssignment.preferListingAgent, 'leadAssignment.agentIds': leadAssignment.agentIds, 'leadAssignment.bySource': leadAssignment.bySource, updatedBy: auth.userId } },
      { upsert: true, new: true },
    );
    const changes = diffFields(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, ['matching', 'sqftPerUnit', 'reminders', 'commission', 'leadScoring', 'automation', 'leadAssignment', 'dealPipeline', 'retention']);
    if (changes.length) await auditService.record(auth, { action: 'settings.updated', entityType: 'settings', changes, ip });
    return next;
  },
};
