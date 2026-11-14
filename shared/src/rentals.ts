/**
 * Rental management: leases, monthly rent schedules, late fees and payment allocation. Pure
 * functions shared by the API (authoritative) and the apps. Amounts are whole rupees.
 */

export const LEASE_STATUSES = ['DRAFT', 'ACTIVE', 'ENDED', 'TERMINATED'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const RENT_ITEM_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED'] as const;
export type RentItemStatus = (typeof RENT_ITEM_STATUSES)[number];

export const LATE_FEE_TYPES = ['NONE', 'FIXED', 'PERCENT'] as const;
export type LateFeeType = (typeof LATE_FEE_TYPES)[number];

export const DEPOSIT_STATUSES = ['HELD', 'PARTIALLY_REFUNDED', 'REFUNDED', 'ADJUSTED'] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const INSPECTION_TYPES = ['MOVE_IN', 'ROUTINE', 'MOVE_OUT'] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const PROPERTY_CONDITIONS = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const;

export interface RentItem {
  _id?: string;
  /** YYYY-MM of the month the rent covers. */
  period: string;
  dueDate: Date | string;
  amount: number;
  lateFee: number;
  paid: number;
  status: RentItemStatus;
}

export interface ScheduleInput {
  startDate: Date | string;
  endDate: Date | string;
  monthlyRent: number;
  /** Day of the month rent is due (1–28). */
  dueDay: number;
  /** Yearly increase in percent (Pakistani leases commonly add 10% a year). */
  escalationPct?: number;
}

const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** One rent item per month from the start month up to (not past) the end date, escalated yearly. */
export function buildRentSchedule(i: ScheduleInput): Omit<RentItem, '_id'>[] {
  const start = new Date(i.startDate);
  const end = new Date(i.endDate);
  if (!(end > start) || !(i.monthlyRent > 0)) return [];
  const day = Math.min(28, Math.max(1, Math.round(i.dueDay || 1)));
  const items: Omit<RentItem, '_id'>[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (let n = 0; n < 240; n++) {
    const monthStart = new Date(Date.UTC(y, m, 1));
    if (monthStart > end) break;
    // The first month is never due before the lease starts.
    const due = new Date(Math.max(Date.UTC(y, m, day), Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())));
    const year = Math.floor(n / 12);
    const amount = Math.round(i.monthlyRent * Math.pow(1 + (i.escalationPct ?? 0) / 100, year));
    items.push({ period: ymd(monthStart), dueDate: due, amount, lateFee: 0, paid: 0, status: 'PENDING' });
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return items;
}

export const itemTotal = (r: Pick<RentItem, 'amount' | 'lateFee'>) => r.amount + (r.lateFee ?? 0);
export const itemBalance = (r: Pick<RentItem, 'amount' | 'lateFee' | 'paid' | 'status'>) => (r.status === 'WAIVED' ? 0 : Math.max(0, itemTotal(r) - (r.paid ?? 0)));

export function statusFor(r: Pick<RentItem, 'amount' | 'lateFee' | 'paid' | 'status' | 'dueDate'>, now = Date.now(), graceDays = 0): RentItemStatus {
  if (r.status === 'WAIVED') return 'WAIVED';
  const balance = itemBalance(r);
  if (balance === 0) return 'PAID';
  const overdue = new Date(r.dueDate).getTime() + graceDays * 86_400_000 < now;
  if (overdue) return 'OVERDUE';
  return (r.paid ?? 0) > 0 ? 'PARTIAL' : 'PENDING';
}

/** Late fee for an item that became overdue (charged once per item). */
export function lateFeeFor(amount: number, type: LateFeeType, value: number): number {
  if (type === 'FIXED') return Math.max(0, Math.round(value));
  if (type === 'PERCENT') return Math.max(0, Math.round((amount * value) / 100));
  return 0;
}

/**
 * Allocates a payment to the oldest unpaid items first. Returns the per-item allocations and any
 * amount left over (an advance, kept on the lease as credit).
 */
export function allocatePayment(items: Pick<RentItem, '_id' | 'amount' | 'lateFee' | 'paid' | 'status' | 'dueDate'>[], amount: number) {
  let left = Math.round(amount);
  const allocations: { itemId: string; amount: number }[] = [];
  const ordered = [...items].sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate));
  for (const it of ordered) {
    if (left <= 0) break;
    const bal = itemBalance(it);
    if (!bal || !it._id) continue;
    const take = Math.min(bal, left);
    allocations.push({ itemId: it._id, amount: take });
    left -= take;
  }
  return { allocations, credit: left };
}

export interface LeaseSummary {
  totalDue: number;
  totalPaid: number;
  outstanding: number;
  overdue: number;
  overdueItems: number;
  nextDue?: { period: string; dueDate: string; balance: number } | null;
}

export function summarizeLease(items: RentItem[], now = Date.now()): LeaseSummary {
  let totalDue = 0;
  let totalPaid = 0;
  let overdue = 0;
  let overdueItems = 0;
  let next: LeaseSummary['nextDue'] = null;
  for (const it of [...items].sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))) {
    if (it.status === 'WAIVED') continue;
    const due = new Date(it.dueDate).getTime();
    const bal = itemBalance(it);
    totalPaid += it.paid ?? 0;
    if (due <= now) {
      totalDue += itemTotal(it);
      if (bal > 0) {
        overdue += bal;
        overdueItems++;
      }
    } else if (!next && bal > 0) {
      next = { period: it.period, dueDate: new Date(it.dueDate).toISOString(), balance: bal };
    }
  }
  return { totalDue, totalPaid, outstanding: Math.max(0, totalDue - Math.min(totalPaid, totalDue)), overdue, overdueItems, nextDue: next };
}
