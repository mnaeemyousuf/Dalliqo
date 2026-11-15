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

/** PENDING → APPROVED (by someone allowed to approve) → PAID. Approval is enforced when the business requires it. */
export const PAYOUT_STATUSES = ['PENDING', 'APPROVED', 'PAID'] as const;
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
  /** Outside parties paid from the commission before the agency's agents (dealer, referrer, other branch). */
  externalShares?: ExternalShareInput[] | null;
  commissionApprovedAt?: Date | string | null;
  /** Corrections to the expected commission (+ / −), e.g. a discount agreed with the buyer. */
  adjustments?: { amount: number }[] | null;
}

export const EXTERNAL_SHARE_KINDS = ['EXTERNAL_DEALER', 'REFERRAL', 'BRANCH'] as const;
export type ExternalShareKind = (typeof EXTERNAL_SHARE_KINDS)[number];

export interface ExternalShareInput {
  _id?: string;
  kind: ExternalShareKind;
  name: string;
  /** PERCENT = % of the total commission; FIXED = rupees. */
  mode: CommissionMode;
  value: number;
  paid?: number;
}

/** Commission lifecycle shown on deals and statements. */
export const COMMISSION_LIFECYCLE = ['EXPECTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'DISTRIBUTED', 'PAID'] as const;
export type CommissionLifecycle = (typeof COMMISSION_LIFECYCLE)[number];

export interface CommissionSummary {
  /** Price commission percentages are applied to: final price, else agreed price. */
  basePrice: number;
  expected: { buyer: number; seller: number; adjustments: number; total: number };
  received: { buyer: number; seller: number; total: number };
  outstanding: number;
  status: CommissionStatus;
  /** Per agent: share of the expected and received commission, and what was paid out to them. */
  agents: { userId: string; sharePct: number; expected: number; received: number; paidOut: number; owed: number }[];
  /** Outside parties' shares (expected on the total, earned in proportion to what was received). */
  external: { _id?: string; kind: ExternalShareKind; name: string; expected: number; earned: number; paid: number; owed: number }[];
  /** Commission the agency keeps before agent shares (total minus external shares). */
  agencyExpected: number;
  agencyReceived: number;
  lifecycle: CommissionLifecycle;
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
  const adjustments = (deal.adjustments ?? []).reduce((s, a) => s + Math.round(a.amount || 0), 0);
  const total = Math.max(0, buyer + seller + adjustments);
  const paid = (side: DealSide) => (deal.payments ?? []).filter((p) => p.side === side).reduce((s, p) => s + (p.amount || 0), 0);
  const rBuyer = paid('BUYER');
  const rSeller = paid('SELLER');
  const received = rBuyer + rSeller;
  // External shares come off the top; agents split what the agency keeps.
  const receivedRatio = total > 0 ? Math.min(1, received / total) : 0;
  const external = (deal.externalShares ?? []).map((x) => {
    const expected = x.mode === 'FIXED' ? round(x.value) : round((total * x.value) / 100);
    const earned = round(expected * receivedRatio);
    const paid = round(x.paid ?? 0);
    return { _id: x._id, kind: x.kind, name: x.name, expected, earned, paid, owed: Math.max(0, earned - paid) };
  });
  const externalExpected = external.reduce((s, x) => s + x.expected, 0);
  const externalEarned = external.reduce((s, x) => s + x.earned, 0);
  const agencyExpected = Math.max(0, total - externalExpected);
  const agencyReceived = Math.max(0, received - externalEarned);
  const agents = (deal.agents ?? []).map((a) => {
    const id = String(a.userId && typeof a.userId === 'object' && '_id' in (a.userId as object) ? (a.userId as { _id: unknown })._id : a.userId);
    const paidOut = (deal.payouts ?? []).filter((p) => String(p.userId) === id && p.status === 'PAID').reduce((s, p) => s + (p.amount || 0), 0);
    const share = round((agencyReceived * a.sharePct) / 100);
    return { userId: id, sharePct: a.sharePct, expected: round((agencyExpected * a.sharePct) / 100), received: share, paidOut, owed: Math.max(0, share - paidOut) };
  });
  const status = commissionStatus(total, received);
  const allPayoutsRecorded = agents.every((a) => (deal.payouts ?? []).filter((p) => String(p.userId) === a.userId).reduce((s, p) => s + p.amount, 0) >= a.received);
  const lifecycle: CommissionLifecycle =
    status === 'PENDING'
      ? deal.commissionApprovedAt
        ? 'APPROVED'
        : 'EXPECTED'
      : status === 'PARTIALLY_RECEIVED'
        ? 'PARTIALLY_RECEIVED'
        : agents.every((a) => a.owed === 0) && external.every((x) => x.owed === 0)
          ? 'PAID'
          : allPayoutsRecorded
            ? 'DISTRIBUTED'
            : 'RECEIVED';
  return {
    basePrice,
    expected: { buyer, seller, adjustments, total },
    received: { buyer: rBuyer, seller: rSeller, total: received },
    outstanding: Math.max(0, total - received),
    status,
    agents,
    external,
    agencyExpected,
    agencyReceived,
    lifecycle,
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
  /** Agent payouts must be approved (deals:approve) before they can be marked paid. */
  payoutApprovalRequired: boolean;
  /**
   * Custom default rates. The first rule that fits a new deal's listing (sale / rent and,
   * optionally, property type) replaces the two defaults above.
   */
  rules?: CommissionRule[];
}

export interface CommissionRule {
  /** SALE or RENT; empty = both. */
  listingPurpose?: 'SALE' | 'RENT' | null;
  /** A property type (e.g. PLOT); empty = any. */
  propertyType?: string | null;
  buyerPct: number;
  sellerPct: number;
}

export const MAX_COMMISSION_RULES = 20;

/** Default buyer / seller percentages for a deal on this kind of listing. */
export function defaultCommissionRates(c: CommissionDefaults, listing?: { listingPurpose?: string | null; propertyType?: string | null } | null): { buyerPct: number; sellerPct: number } {
  const rule = listing
    ? (c.rules ?? []).find((r) => (r.listingPurpose || r.propertyType) && (!r.listingPurpose || r.listingPurpose === listing.listingPurpose) && (!r.propertyType || r.propertyType === listing.propertyType))
    : undefined;
  return rule ? { buyerPct: rule.buyerPct, sellerPct: rule.sellerPct } : { buyerPct: c.defaultBuyerPct, sellerPct: c.defaultSellerPct };
}

export const DEFAULT_COMMISSION_SETTINGS: CommissionDefaults = { defaultBuyerPct: 1, defaultSellerPct: 1, autoCreateIncome: true, closeApprovalRequired: false, payoutApprovalRequired: false };

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
