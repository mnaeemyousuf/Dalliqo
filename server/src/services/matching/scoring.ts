import {
  RELATED_PROPERTY_TYPES,
  matchBand,
  type ClientPurpose,
  type ListingPurpose,
  type MatchBand,
  type MatchingSettings,
  type PropertyType,
} from '@recrm/shared';
import type { MatchReason } from '../../models/Match';
import { normalizeText } from '../../utils/text';

/**
 * Pure scoring functions for the matching engine. No I/O, so every rule is
 * unit-tested directly (tests/matching.scoring.test.ts).
 */

export interface ScoringProperty {
  propertyType: PropertyType;
  listingPurpose: ListingPurpose;
  society?: string;
  area?: string;
  block?: string;
  sizeSqft?: number;
  askingPrice: number;
  minimumPrice?: number;
  negotiable?: boolean;
}

export interface ScoringRequirement {
  purpose: ClientPurpose;
  propertyTypes: PropertyType[];
  areas: string[];
  societies: string[];
  blocks: string[];
  minSizeSqft?: number;
  maxSizeSqft?: number;
  minBudget?: number;
  maxBudget?: number;
}

export interface ScoreResult {
  matchScore: number;
  band: MatchBand;
  breakdown: { type: number; location: number; budget: number; size: number; purpose: number };
  matchReasons: MatchReason[];
}

interface Part {
  fraction: number;
  reason?: MatchReason;
}

export function purposeCompatible(clientPurpose: ClientPurpose, listing: ListingPurpose): boolean {
  return (clientPurpose === 'PURCHASE' && listing === 'SALE') || (clientPurpose === 'RENTAL' && listing === 'RENT');
}

/** Exact after normalisation, or one name contains the other ("dha" ⊂ "dha karachi"). */
export function placeMatches(a: string | undefined, b: string | undefined): boolean {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return (x.length >= 3 && y.includes(x)) || (y.length >= 3 && x.includes(y));
}

export function scoreType(req: ScoringRequirement, p: ScoringProperty): Part {
  if (!req.propertyTypes.length) return { fraction: 0.5, reason: { code: 'TYPE_ANY' } };
  if (req.propertyTypes.includes(p.propertyType)) return { fraction: 1, reason: { code: 'TYPE_MATCH' } };
  const related = req.propertyTypes.some((t) => RELATED_PROPERTY_TYPES[t]?.includes(p.propertyType));
  return related ? { fraction: 0.6, reason: { code: 'TYPE_RELATED' } } : { fraction: 0 };
}

export function scoreLocation(req: ScoringRequirement, p: ScoringProperty): Part {
  const wanted = [...req.societies, ...req.areas].filter((s) => normalizeText(s));
  if (!wanted.length) return { fraction: 0.5, reason: { code: 'LOCATION_ANY' } };

  const society = wanted.find((w) => placeMatches(w, p.society));
  if (society) {
    const blocks = req.blocks.filter((b) => normalizeText(b));
    if (blocks.length && !blocks.some((b) => normalizeText(b) === normalizeText(p.block))) {
      return { fraction: 0.8, reason: { code: 'SOCIETY_MATCH_OTHER_BLOCK', params: { society: p.society ?? society } } };
    }
    return { fraction: 1, reason: { code: 'SOCIETY_MATCH', params: { society: p.society ?? society } } };
  }
  const area = wanted.find((w) => placeMatches(w, p.area));
  if (area) return { fraction: 0.6, reason: { code: 'AREA_MATCH', params: { area: p.area ?? area } } };
  return { fraction: 0 };
}

export function scoreBudget(req: ScoringRequirement, p: ScoringProperty): Part {
  const { minBudget: min, maxBudget: max } = req;
  if (min === undefined && max === undefined) return { fraction: 0.5, reason: { code: 'BUDGET_ANY' } };
  const price = p.askingPrice;

  if (max !== undefined && price > max) {
    const over = max > 0 ? (price - max) / max : Infinity;
    let fraction = over <= 0.05 ? 0.7 : over <= 0.1 ? 0.45 : over <= 0.2 ? 0.2 : 0;
    let reason: MatchReason | undefined =
      fraction > 0 ? { code: 'BUDGET_SLIGHTLY_OVER', params: { percent: Math.ceil(over * 100) } } : undefined;
    if (p.negotiable && p.minimumPrice !== undefined && p.minimumPrice <= max && fraction < 0.8) {
      fraction = 0.8;
      reason = { code: 'BUDGET_NEGOTIABLE' };
    }
    return { fraction, reason };
  }
  if (min !== undefined && price < min) return { fraction: 0.85, reason: { code: 'BUDGET_BELOW_MIN' } };
  return { fraction: 1, reason: { code: 'BUDGET_WITHIN' } };
}

export function scoreSize(req: ScoringRequirement, p: ScoringProperty): Part {
  const { minSizeSqft: lo, maxSizeSqft: hi } = req;
  if ((lo === undefined && hi === undefined) || !p.sizeSqft) return { fraction: 0.5, reason: { code: 'SIZE_ANY' } };
  const s = p.sizeSqft;
  const min = lo ?? 0;
  const max = hi ?? Infinity;
  if (s >= min && s <= max) return { fraction: 1, reason: { code: 'SIZE_WITHIN' } };
  const deviation = s < min ? (min - s) / min : (s - max) / max;
  if (deviation <= 0.1) return { fraction: 0.65, reason: { code: 'SIZE_CLOSE' } };
  if (deviation <= 0.2) return { fraction: 0.3, reason: { code: 'SIZE_CLOSE' } };
  return { fraction: 0 };
}

/** Returns null when the purpose is incompatible (a hard disqualifier). */
export function scoreMatch(req: ScoringRequirement, p: ScoringProperty, weights: MatchingSettings['weights']): ScoreResult | null {
  if (!purposeCompatible(req.purpose, p.listingPurpose)) return null;

  const parts = {
    type: scoreType(req, p),
    location: scoreLocation(req, p),
    budget: scoreBudget(req, p),
    size: scoreSize(req, p),
    purpose: { fraction: 1, reason: { code: 'PURPOSE_MATCH' } } as Part,
  };
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const breakdown = {
    type: round1(weights.type * parts.type.fraction),
    location: round1(weights.location * parts.location.fraction),
    budget: round1(weights.budget * parts.budget.fraction),
    size: round1(weights.size * parts.size.fraction),
    purpose: round1(weights.purpose * parts.purpose.fraction),
  };
  const matchScore = Math.max(
    0,
    Math.min(100, Math.round(breakdown.type + breakdown.location + breakdown.budget + breakdown.size + breakdown.purpose)),
  );
  const matchReasons = Object.values(parts)
    .map((x) => x.reason)
    .filter((r): r is MatchReason => !!r);
  return { matchScore, band: matchBand(matchScore), breakdown, matchReasons };
}
