/**
 * Installment plans for sales (booking + down payment + periodic installments, or a custom
 * schedule). Payment allocation and statuses reuse the rental helpers (oldest due first).
 */
export const INSTALLMENT_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM'] as const;
export type InstallmentFrequency = (typeof INSTALLMENT_FREQUENCIES)[number];

export const INSTALLMENT_PLAN_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type InstallmentPlanStatus = (typeof INSTALLMENT_PLAN_STATUSES)[number];

export const INSTALLMENT_KINDS = ['BOOKING', 'DOWN_PAYMENT', 'INSTALLMENT', 'BALLOON', 'POSSESSION'] as const;
export type InstallmentKind = (typeof INSTALLMENT_KINDS)[number];

const MONTHS: Record<Exclude<InstallmentFrequency, 'CUSTOM'>, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };

export interface InstallmentPlanInput {
  totalAmount: number;
  bookingAmount?: number;
  downPayment?: number;
  /** Paid at possession (often 10–20% in Pakistani developer plans). */
  possessionAmount?: number;
  frequency: InstallmentFrequency;
  count: number;
  startDate: Date | string;
}

export interface PlannedInstallment {
  kind: InstallmentKind;
  label: string;
  dueDate: Date;
  amount: number;
}

/** Splits what is left after booking, down payment and possession equally (rounding goes to the last one). */
export function buildInstallmentSchedule(i: InstallmentPlanInput): PlannedInstallment[] {
  const start = new Date(i.startDate);
  const items: PlannedInstallment[] = [];
  const booking = Math.round(i.bookingAmount ?? 0);
  const down = Math.round(i.downPayment ?? 0);
  const possession = Math.round(i.possessionAmount ?? 0);
  if (booking > 0) items.push({ kind: 'BOOKING', label: 'Booking', dueDate: start, amount: booking });
  if (down > 0) items.push({ kind: 'DOWN_PAYMENT', label: 'Down payment', dueDate: start, amount: down });
  const rest = Math.max(0, Math.round(i.totalAmount) - booking - down - possession);
  const count = i.frequency === 'CUSTOM' ? 0 : Math.max(0, Math.round(i.count));
  if (count > 0 && rest > 0) {
    const step = MONTHS[i.frequency as Exclude<InstallmentFrequency, 'CUSTOM'>];
    const each = Math.floor(rest / count);
    for (let n = 1; n <= count; n++) {
      const due = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n * step, Math.min(start.getUTCDate(), 28)));
      items.push({ kind: 'INSTALLMENT', label: `Installment ${n}/${count}`, dueDate: due, amount: n === count ? rest - each * (count - 1) : each });
    }
  }
  if (possession > 0) {
    const last = items[items.length - 1]?.dueDate ?? start;
    items.push({ kind: 'POSSESSION', label: 'On possession', dueDate: new Date(last.getTime() + 30 * 86_400_000), amount: possession });
  }
  return items;
}

/** Days-overdue buckets used by the receivables / payables aging reports. */
export const AGING_BUCKETS = [
  { key: 'CURRENT', maxDays: 0 },
  { key: '1_30', maxDays: 30 },
  { key: '31_60', maxDays: 60 },
  { key: '61_90', maxDays: 90 },
  { key: '90_PLUS', maxDays: Infinity },
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number]['key'];

export function agingBucket(dueDate: Date | string, now = Date.now()): AgingBucket {
  const days = Math.floor((now - new Date(dueDate).getTime()) / 86_400_000);
  return (AGING_BUCKETS.find((b) => days <= b.maxDays) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1]).key;
}

/** Whole-rupee amount in words (Pakistani style: lakh, crore) for receipts. */
export function rupeesInWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`);
  const three = (n: number) => (n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${two(n % 100)}` : ''}` : two(n));
  let n = Math.round(Math.abs(amount));
  if (n === 0) return 'Zero Rupees';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${crore >= 100 ? three(crore) : two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `${parts.join(' ')} Rupees Only`;
}
