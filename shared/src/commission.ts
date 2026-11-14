/**
 * Commission maths for deals, shared by the API and the web app (the Flutter app mirrors it in
 * lib/core/commission/commission.dart, tested against the same cases). Amounts are whole rupees.
 */

export const DEAL_STAGES = ['INQUIRY', 'QUALIFIED', 'SITE_VISIT', 'NEGOTIATION', 'OFFER', 'TOKEN', 'AGREEMENT', 'PAYMENT', 'TRANSFER', 'CLOSED_WON', 'CLOSED_LOST'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

/** Stages of a deal still in progress (the pipeline columns before won/lost). */
export const OPEN_DEAL_STAGES: readonly DealStage[] = ['INQUIRY', 'QUALIFIED', 'SITE_VISIT', 'NEGOTIATION', 'OFFER', 'TOKEN', 'AGREEMENT', 'PAYMENT', 'TRANSFER'];

/** Who made an offer in a negotiation, and where the offer stands. */
export const OFFER_PARTIES = ['BUYER', 'SELLER'] as const;
export type OfferParty = (typeof OFFER_PARTIES)[number];
export const OFFER_STATUSES = ['OPEN', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'WITHDRAWN'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Default deal-closing checklist. */
export const DEAL_CHECKLIST_ITEMS = [
  'DOCUMENTS_COLLECTED',
  'BUYER_VERIFIED',
  'SELLER_VERIFIED',
  'TOKEN_RECEIVED',
  'AGREEMENT_SIGNED',
  'DUES_CHECKED',
  'TRANSFER_DOCS_READY',
  'PAYMENT_COMPLETED',
  'COMMISSION_RECEIVED',
  'DEAL_CLOSED',
] as const;
export type DealChecklistItem = (typeof DEAL_CHECKLIST_ITEMS)[number];

export const COMMISSION_MODES = ['PERCENT', 'FIXED'] as const;
export type CommissionMode = (typeof COMMISSION_MODES)[number];

export const DEAL_SIDES = ['BUYER', 'SELLER'] as const;
export type DealSide = (typeof DEAL_SIDES)[number];

export const COMMISSION_STATUSES = ['PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const PAYOUT_STATUSES = ['PENDING', 'PAID'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** How money changed hands (commission payments and income/expense transactions). */
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'JAZZCASH', 'EASYPAISA', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface CommissionTerm {
  mode: CommissionMode;
  /** Percent (e.g. 1 = 1%) or a fixed amount in rupees. */
  value: number;
}

export interface DealMoney {
  agreedPrice?: number | null;
  finalPrice?: number | null;
  commission?: { buyer?: CommissionTerm | null; seller?: CommissionTerm | null } | null;
  agents?: { userId: unknown; sharePct: number }[] | null;
  payments?: { side: DealSide; amount: number }[] | null;
  payouts?: { userId: unknown; amount: number; status: PayoutStatus }[] | null;
}

export interface CommissionSummary {
  /** Price commission percentages are applied to: final price, else agreed price. */
  basePrice: number;
  expected: { buyer: number; seller: number; total: number };
  received: { buyer: number; seller: number; total: number };
  outstanding: number;
  status: CommissionStatus;
  /** Per agent: share of the expected and received commission, and what was paid out to them. */
  agents: { userId: string; sharePct: number; expected: number; received: number; paidOut: number; owed: number }[];
}

const round = (n: number) => Math.round(n);

/** Expected commission for one side of the deal. */
export function sideExpected(term: CommissionTerm | null | undefined, basePrice: number): number {
  if (!term || !(term.value > 0)) return 0;
  return term.mode === 'FIXED' ? round(term.value) : round((basePrice * term.value) / 100);
}

export function commissionStatus(expected: number, received: number): CommissionStatus {
  if (received <= 0) return 'PENDING';
  return received >= expected && expected > 0 ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
}

/** Everything the deal screens and reports show about a deal's commission. */
export function summarizeCommission(deal: DealMoney): CommissionSummary {
  const basePrice = deal.finalPrice ?? deal.agreedPrice ?? 0;
  const buyer = sideExpected(deal.commission?.buyer, basePrice);
  const seller = sideExpected(deal.commission?.seller, basePrice);
  const total = buyer + seller;
  const paid = (side: DealSide) => (deal.payments ?? []).filter((p) => p.side === side).reduce((s, p) => s + (p.amount || 0), 0);
  const rBuyer = paid('BUYER');
  const rSeller = paid('SELLER');
  const received = rBuyer + rSeller;
  const agents = (deal.agents ?? []).map((a) => {
    const id = String(a.userId && typeof a.userId === 'object' && '_id' in (a.userId as object) ? (a.userId as { _id: unknown })._id : a.userId);
    const paidOut = (deal.payouts ?? []).filter((p) => String(p.userId) === id && p.status === 'PAID').reduce((s, p) => s + (p.amount || 0), 0);
    const share = round((received * a.sharePct) / 100);
    return { userId: id, sharePct: a.sharePct, expected: round((total * a.sharePct) / 100), received: share, paidOut, owed: Math.max(0, share - paidOut) };
  });
  return {
    basePrice,
    expected: { buyer, seller, total },
    received: { buyer: rBuyer, seller: rSeller, total: received },
    outstanding: Math.max(0, total - received),
    status: commissionStatus(total, received),
    agents,
  };
}

/** Agent shares must add up to 100% (rounding tolerance of 0.01). */
export function sharesValid(agents: { sharePct: number }[]): boolean {
  if (!agents.length) return false;
  const sum = agents.reduce((s, a) => s + a.sharePct, 0);
  return Math.abs(sum - 100) < 0.01 && agents.every((a) => a.sharePct > 0);
}

export interface CommissionDefaults {
  defaultBuyerPct: number;
  defaultSellerPct: number;
  /** Record every commission payment as an income transaction automatically. */
  autoCreateIncome: boolean;
  /** Closing a deal as won needs approval from a member with deals:approve. */
  closeApprovalRequired: boolean;
}

export const DEFAULT_COMMISSION_SETTINGS: CommissionDefaults = { defaultBuyerPct: 1, defaultSellerPct: 1, autoCreateIncome: true, closeApprovalRequired: false };

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
