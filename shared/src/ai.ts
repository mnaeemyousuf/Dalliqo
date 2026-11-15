/**
 * Intelligence features that work WITHOUT an AI provider (pure, testable maths), plus the
 * shared vocabulary of the AI layer. Language-model features (assistant, descriptions, client
 * briefs) live on the server and fall back to these / to templates when no key is configured.
 */
import type { DealStage } from './commission';

export const AI_FEATURES = ['assistant', 'description', 'client_brief', 'forecast', 'price_estimate'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** Likelihood a deal at this stage closes as won — used to weight the pipeline forecast. */
export const DEAL_STAGE_PROBABILITY: Record<DealStage, number> = {
  INQUIRY: 0.05,
  QUALIFIED: 0.1,
  SITE_VISIT: 0.2,
  NEGOTIATION: 0.35,
  OFFER: 0.5,
  TOKEN: 0.7,
  AGREEMENT: 0.8,
  PAYMENT: 0.9,
  TRANSFER: 0.95,
  CLOSED_WON: 1,
  CLOSED_LOST: 0,
};

/** Days a deal typically still needs from a stage to closing, when no expected close date is set. */
const DAYS_TO_CLOSE: Record<DealStage, number> = { INQUIRY: 90, QUALIFIED: 75, SITE_VISIT: 60, NEGOTIATION: 45, OFFER: 30, TOKEN: 21, AGREEMENT: 14, PAYMENT: 10, TRANSFER: 5, CLOSED_WON: 0, CLOSED_LOST: 0 };

export interface ForecastDeal {
  stage: DealStage;
  outstanding: number;
  expectedCloseDate?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface ForecastMonth {
  month: string;
  /** Commission still to be received on open deals expected to close this month, weighted by stage. */
  weighted: number;
  /** Unweighted (best case). */
  bestCase: number;
  deals: number;
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Weighted commission forecast for the next `months` months. Overdue expected dates land in the
 * current month; deals without a date are placed by typical time-to-close for their stage.
 * `probability` lets a business use its own stage weights (Settings → deal pipeline).
 */
export function forecastCommission(deals: ForecastDeal[], now = new Date(), months = 6, probability: Record<DealStage, number> = DEAL_STAGE_PROBABILITY): { months: ForecastMonth[]; weightedTotal: number; bestCaseTotal: number } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const keys = Array.from({ length: months }, (_, i) => monthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))));
  const out = new Map(keys.map((k) => [k, { month: k, weighted: 0, bestCase: 0, deals: 0 }]));
  for (const d of deals) {
    if (d.stage === 'CLOSED_LOST' || !(d.outstanding > 0)) continue;
    let when = d.expectedCloseDate ? new Date(d.expectedCloseDate) : new Date(now.getTime() + DAYS_TO_CLOSE[d.stage] * 86_400_000);
    if (when < start) when = start;
    const row = out.get(monthKey(when));
    if (!row) continue; // beyond the horizon
    row.weighted += Math.round(d.outstanding * (probability[d.stage] ?? DEAL_STAGE_PROBABILITY[d.stage]));
    row.bestCase += Math.round(d.outstanding);
    row.deals += 1;
  }
  const list = [...out.values()];
  return { months: list, weightedTotal: list.reduce((s, m) => s + m.weighted, 0), bestCaseTotal: list.reduce((s, m) => s + m.bestCase, 0) };
}

export interface Comparable {
  price: number;
  sizeSqft: number;
  /** ASKING (listed) or SOLD (closed deal price — counts more). */
  kind: 'ASKING' | 'SOLD';
}

export interface PriceEstimate {
  low: number;
  mid: number;
  high: number;
  perSqft: number;
  comparables: number;
  sold: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Indicative price from comparable listings and sales (price per sq ft, IQR range). Sold prices
 * count twice. This is an estimate for guidance, never a valuation — callers must label it so.
 */
export function estimatePrice(sizeSqft: number, comps: Comparable[]): PriceEstimate | null {
  const rates: number[] = [];
  for (const c of comps) {
    if (!(c.price > 0) || !(c.sizeSqft > 0)) continue;
    const r = c.price / c.sizeSqft;
    rates.push(r);
    if (c.kind === 'SOLD') rates.push(r);
  }
  if (!(sizeSqft > 0) || rates.length < 3) return null;
  rates.sort((a, b) => a - b);
  // Drop extreme outliers (beyond 3× IQR) so one typo doesn't swing the estimate.
  const q1 = quantile(rates, 0.25);
  const q3 = quantile(rates, 0.75);
  const iqr = q3 - q1;
  const kept = rates.filter((r) => r >= q1 - 3 * iqr && r <= q3 + 3 * iqr);
  const med = quantile(kept, 0.5);
  const lo = quantile(kept, 0.25);
  const hi = quantile(kept, 0.75);
  const n = comps.filter((c) => c.price > 0 && c.sizeSqft > 0).length;
  const sold = comps.filter((c) => c.kind === 'SOLD' && c.price > 0 && c.sizeSqft > 0).length;
  const spread = med > 0 ? (hi - lo) / med : 1;
  const confidence: PriceEstimate['confidence'] = n >= 10 && spread < 0.35 ? 'HIGH' : n >= 5 && spread < 0.6 ? 'MEDIUM' : 'LOW';
  const round = (v: number) => Math.round(v / 10_000) * 10_000;
  return { low: round(lo * sizeSqft), mid: round(med * sizeSqft), high: round(hi * sizeSqft), perSqft: Math.round(med), comparables: n, sold, confidence };
}
