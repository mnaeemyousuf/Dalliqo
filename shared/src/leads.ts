/**
 * Lead management: temperature, buying timeline, lost reasons and the configurable lead-scoring
 * engine. Pure functions so the API (authoritative), the web app and tests share one implementation;
 * the Flutter app shows the score the API stored on the client.
 */

export const LEAD_TEMPERATURES = ['HOT', 'WARM', 'COLD'] as const;
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

export const BUYING_TIMELINES = ['IMMEDIATE', 'ONE_MONTH', 'THREE_MONTHS', 'SIX_MONTHS', 'EXPLORING'] as const;
export type BuyingTimeline = (typeof BUYING_TIMELINES)[number];

export const LOST_REASONS = ['BUDGET', 'BOUGHT_ELSEWHERE', 'NOT_RESPONDING', 'NOT_INTERESTED', 'REQUIREMENT_CHANGED', 'INVALID_CONTACT', 'DUPLICATE', 'OTHER'] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const LEAD_SCORE_FACTORS = ['budget', 'location', 'category', 'intent', 'engagement', 'followUps', 'timeline'] as const;
export type LeadScoreFactor = (typeof LEAD_SCORE_FACTORS)[number];

export interface LeadScoringSettings {
  /** Relative weight of each factor (normalised, so they need not add up to 100). */
  weights: Record<LeadScoreFactor, number>;
  /** Score at or above which a lead is HOT / WARM (otherwise COLD). */
  hotThreshold: number;
  warmThreshold: number;
}

/**
 * Who gets new website / WhatsApp leads. The listing's agent always comes first when
 * `preferListingAgent` is on; otherwise (or when there is none) the mode decides.
 */
export const LEAD_ASSIGNMENT_MODES = ['NONE', 'ROUND_ROBIN', 'BY_SOURCE'] as const;
export type LeadAssignmentMode = (typeof LEAD_ASSIGNMENT_MODES)[number];
export interface LeadAssignmentSettings {
  mode: LeadAssignmentMode;
  preferListingAgent: boolean;
  /** Round-robin pool (user ids). */
  agentIds: string[];
  /** BY_SOURCE: source → user id (sources without a rule fall back to the round-robin pool). */
  bySource: { source: string; userId: string }[];
}
/** How long logs are kept, in months (0 = forever). Business records are never purged. */
export interface RetentionSettings {
  auditLogMonths: number;
  activityMonths: number;
}
export const DEFAULT_RETENTION: RetentionSettings = { auditLogMonths: 0, activityMonths: 0 };
/** Shortest periods allowed, so a trail always exists for recent work. */
export const MIN_RETENTION = { auditLogMonths: 12, activityMonths: 6 } as const;

export const DEFAULT_LEAD_ASSIGNMENT: LeadAssignmentSettings = { mode: 'NONE', preferListingAgent: true, agentIds: [], bySource: [] };

export const DEFAULT_LEAD_SCORING: LeadScoringSettings = {
  weights: { budget: 20, location: 15, category: 10, intent: 10, engagement: 20, followUps: 10, timeline: 15 },
  hotThreshold: 70,
  warmThreshold: 40,
};

/** Codes the apps translate (lead.scoreReasons.<code>). */
export const LEAD_SCORE_REASONS = [
  'BUDGET_MATCHES_INVENTORY',
  'BUDGET_NO_MATCHES',
  'BUDGET_MISSING',
  'LOCATION_PRECISE',
  'LOCATION_AREA_ONLY',
  'LOCATION_MISSING',
  'CATEGORY_SET',
  'CATEGORY_MISSING',
  'INTENT_ACTIVE',
  'INTENT_ON_HOLD',
  'INTENT_CLOSED',
  'CONTACTED_RECENTLY',
  'CONTACTED_THIS_WEEK',
  'CONTACTED_THIS_MONTH',
  'NOT_CONTACTED_LONG',
  'NEW_LEAD',
  'NEVER_CONTACTED',
  'FOLLOWUPS_DONE',
  'FOLLOWUP_DONE',
  'FOLLOWUP_SCHEDULED',
  'NO_FOLLOWUPS',
  'FOLLOWUPS_OVERDUE',
  'TIMELINE_IMMEDIATE',
  'TIMELINE_ONE_MONTH',
  'TIMELINE_THREE_MONTHS',
  'TIMELINE_SIX_MONTHS',
  'TIMELINE_EXPLORING',
  'TIMELINE_UNKNOWN',
] as const;
export type LeadScoreReasonCode = (typeof LEAD_SCORE_REASONS)[number];

export interface LeadScoreReason {
  factor: LeadScoreFactor;
  code: LeadScoreReasonCode;
  /** Points this factor contributed (out of its weight share of 100). */
  points: number;
  /** Maximum points the factor could have contributed. */
  max: number;
  positive: boolean;
}

export interface LeadScoreInput {
  status?: string | null;
  purpose?: string | null;
  minBudget?: number | null;
  maxBudget?: number | null;
  societies?: string[] | null;
  blocks?: string[] | null;
  areas?: string[] | null;
  propertyTypes?: string[] | null;
  matchCount?: number | null;
  createdAt?: Date | string | null;
  lastContactedAt?: Date | string | null;
  followUpsCompleted?: number;
  followUpsPending?: number;
  followUpsOverdue?: number;
  buyingTimeline?: BuyingTimeline | null;
}

export interface LeadScore {
  score: number;
  temperature: LeadTemperature;
  reasons: LeadScoreReason[];
}

const DAY = 86_400_000;
const daysSince = (d: Date | string | null | undefined, now: number) => (d ? (now - new Date(d).getTime()) / DAY : null);

/** Each factor scores 0..1 with the reason that explains it. */
function factors(i: LeadScoreInput, now: number): Record<LeadScoreFactor, [number, LeadScoreReasonCode]> {
  const hasBudget = (i.maxBudget ?? 0) > 0 || (i.minBudget ?? 0) > 0;
  const budget: [number, LeadScoreReasonCode] = !hasBudget
    ? [0, 'BUDGET_MISSING']
    : (i.matchCount ?? 0) > 0
      ? [1, 'BUDGET_MATCHES_INVENTORY']
      : [0.45, 'BUDGET_NO_MATCHES'];

  const precise = (i.societies?.length ?? 0) > 0;
  const location: [number, LeadScoreReasonCode] = precise
    ? [(i.blocks?.length ?? 0) > 0 ? 1 : 0.85, 'LOCATION_PRECISE']
    : (i.areas?.length ?? 0) > 0
      ? [0.6, 'LOCATION_AREA_ONLY']
      : [0, 'LOCATION_MISSING'];

  const category: [number, LeadScoreReasonCode] = (i.propertyTypes?.length ?? 0) > 0 ? [1, 'CATEGORY_SET'] : [0, 'CATEGORY_MISSING'];

  const status = i.status ?? 'ACTIVE';
  const intent: [number, LeadScoreReasonCode] =
    status === 'ACTIVE' ? [i.purpose ? 1 : 0.7, 'INTENT_ACTIVE'] : status === 'ON_HOLD' ? [0.3, 'INTENT_ON_HOLD'] : [0, 'INTENT_CLOSED'];

  const contacted = daysSince(i.lastContactedAt, now);
  const age = daysSince(i.createdAt, now);
  const engagement: [number, LeadScoreReasonCode] =
    contacted === null
      ? age !== null && age < 1
        ? [0.5, 'NEW_LEAD']
        : [0, 'NEVER_CONTACTED']
      : contacted <= 3
        ? [1, 'CONTACTED_RECENTLY']
        : contacted <= 7
          ? [0.7, 'CONTACTED_THIS_WEEK']
          : contacted <= 30
            ? [0.4, 'CONTACTED_THIS_MONTH']
            : [0.1, 'NOT_CONTACTED_LONG'];

  const done = i.followUpsCompleted ?? 0;
  let followUps: [number, LeadScoreReasonCode] =
    done >= 2 ? [1, 'FOLLOWUPS_DONE'] : done === 1 ? [0.6, 'FOLLOWUP_DONE'] : (i.followUpsPending ?? 0) > 0 ? [0.4, 'FOLLOWUP_SCHEDULED'] : [0, 'NO_FOLLOWUPS'];
  if ((i.followUpsOverdue ?? 0) > 0) followUps = [followUps[0] * 0.5, 'FOLLOWUPS_OVERDUE'];

  const timelineScore: Record<BuyingTimeline, [number, LeadScoreReasonCode]> = {
    IMMEDIATE: [1, 'TIMELINE_IMMEDIATE'],
    ONE_MONTH: [0.8, 'TIMELINE_ONE_MONTH'],
    THREE_MONTHS: [0.55, 'TIMELINE_THREE_MONTHS'],
    SIX_MONTHS: [0.3, 'TIMELINE_SIX_MONTHS'],
    EXPLORING: [0.1, 'TIMELINE_EXPLORING'],
  };
  const timeline = i.buyingTimeline ? timelineScore[i.buyingTimeline] : ([0.35, 'TIMELINE_UNKNOWN'] as [number, LeadScoreReasonCode]);

  return { budget, location, category, intent, engagement, followUps, timeline };
}

export function temperatureFor(score: number, s: Pick<LeadScoringSettings, 'hotThreshold' | 'warmThreshold'> = DEFAULT_LEAD_SCORING): LeadTemperature {
  return score >= s.hotThreshold ? 'HOT' : score >= s.warmThreshold ? 'WARM' : 'COLD';
}

/**
 * Score 0–100 with an explanation per factor. Weights are normalised so a business can configure
 * them freely; a factor with weight 0 is ignored.
 */
export function scoreLead(input: LeadScoreInput, settings: LeadScoringSettings = DEFAULT_LEAD_SCORING, now = Date.now()): LeadScore {
  const f = factors(input, now);
  const total = LEAD_SCORE_FACTORS.reduce((s, k) => s + Math.max(0, settings.weights[k] ?? 0), 0) || 1;
  let score = 0;
  const reasons: LeadScoreReason[] = [];
  for (const k of LEAD_SCORE_FACTORS) {
    const w = Math.max(0, settings.weights[k] ?? 0);
    if (!w) continue;
    const max = (w / total) * 100;
    const points = f[k][0] * max;
    score += points;
    reasons.push({ factor: k, code: f[k][1], points: Math.round(points * 10) / 10, max: Math.round(max * 10) / 10, positive: f[k][0] >= 0.5 });
  }
  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  // Strongest contributions first, then the biggest gaps, so the explanation reads naturally.
  reasons.sort((a, b) => Number(b.positive) - Number(a.positive) || (a.positive ? b.points - a.points : b.max - b.points - (a.max - a.points)));
  return { score: rounded, temperature: temperatureFor(rounded, settings), reasons };
}

/** Days-since-creation buckets used by the lead aging report. */
export const LEAD_AGING_BUCKETS = [
  { key: '0_7', maxDays: 7 },
  { key: '8_30', maxDays: 30 },
  { key: '31_90', maxDays: 90 },
  { key: '90_PLUS', maxDays: Infinity },
] as const;
