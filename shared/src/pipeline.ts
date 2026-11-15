/**
 * Configurable deal pipeline. The stage keys stay fixed (reports, sync and the commission engine
 * depend on them); a business decides which middle stages it uses, what they are called (English /
 * Urdu) and how likely a deal at each stage is to close — which drives the commission forecast.
 */
import { DEAL_STAGE_PROBABILITY } from './ai';
import { DEAL_STAGES, OPEN_DEAL_STAGES, type DealStage } from './commission';

/** Always on: every deal starts at INQUIRY and ends WON or LOST. */
export const REQUIRED_DEAL_STAGES: readonly DealStage[] = ['INQUIRY', 'CLOSED_WON', 'CLOSED_LOST'];

export interface DealStageConfig {
  stage: DealStage;
  enabled: boolean;
  /** Custom names; empty = the built-in translation. */
  label: string;
  labelUr: string;
  /** Chance (0–1) that a deal at this stage closes as won. */
  probability: number;
}

export interface DealPipelineSettings {
  stages: DealStageConfig[];
}

export const DEFAULT_DEAL_PIPELINE: DealPipelineSettings = {
  stages: DEAL_STAGES.map((stage) => ({ stage, enabled: true, label: '', labelUr: '', probability: DEAL_STAGE_PROBABILITY[stage] })),
};

/** Full, ordered pipeline from stored (possibly partial) settings — unknown entries are ignored. */
export function normalizeDealPipeline(stored?: { stages?: Partial<DealStageConfig>[] | null } | null): DealPipelineSettings {
  const byStage = new Map((stored?.stages ?? []).filter((s) => s?.stage).map((s) => [s.stage as DealStage, s]));
  return {
    stages: DEFAULT_DEAL_PIPELINE.stages.map((def) => {
      const s = byStage.get(def.stage) ?? {};
      const required = REQUIRED_DEAL_STAGES.includes(def.stage);
      const p = typeof s.probability === 'number' && s.probability >= 0 && s.probability <= 1 ? s.probability : def.probability;
      return {
        stage: def.stage,
        enabled: required ? true : s.enabled ?? true,
        label: (s.label ?? '').trim(),
        labelUr: (s.labelUr ?? '').trim(),
        // Won / lost are certainties, whatever is stored.
        probability: def.stage === 'CLOSED_WON' ? 1 : def.stage === 'CLOSED_LOST' ? 0 : p,
      };
    }),
  };
}

export function isDealStageEnabled(p: DealPipelineSettings, stage: DealStage): boolean {
  return p.stages.find((s) => s.stage === stage)?.enabled ?? true;
}

/** The open stages this business uses, in pipeline order. */
export function activeOpenStages(p: DealPipelineSettings): DealStage[] {
  return OPEN_DEAL_STAGES.filter((s) => isDealStageEnabled(p, s));
}

export function stageProbabilities(p: DealPipelineSettings): Record<DealStage, number> {
  return Object.fromEntries(p.stages.map((s) => [s.stage, s.probability])) as Record<DealStage, number>;
}
