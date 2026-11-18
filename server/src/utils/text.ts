import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Normalises place and person names for matching and search:
 * "Gulshan-e-Iqbal", "gulshan e iqbal" and "GULSHAN-E-IQBAL " all become
 * "gulshan e iqbal". Urdu script is kept as-is (only whitespace collapsed).
 */
export function normalizeText(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escapes user input for safe use inside a RegExp (search boxes). */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds the lowercase search blob stored on records for fast prefix search. */
export function searchBlob(...parts: (string | number | undefined | null)[]): string {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .map((p) => normalizeText(String(p)))
    .join(' ');
}

/**
 * The business's currency for the current request (set by `authenticate`, or by public pages
 * from the site / portal owner). Code outside a request falls back to PKR.
 */
const moneyContext = new AsyncLocalStorage<{ currency: string }>();

export function withCurrency<T>(currency: string | undefined | null, fn: () => T): T {
  return moneyContext.run({ currency: normalizeCurrency(currency) }, fn);
}

export function currentCurrency(): string {
  return moneyContext.getStore()?.currency ?? 'PKR';
}

export function normalizeCurrency(code: string | undefined | null): string {
  const c = (code ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'PKR';
}

/** Currencies written with lakh / crore (South Asian numbering). */
export const LAKH_CURRENCIES = new Set(['PKR', 'INR', 'BDT', 'NPR', 'LKR']);

/**
 * Money in the business's currency. Pakistani style for PKR (and other lakh / crore currencies):
 * "15500000" -> "PKR 1.55 Crore", "550000" -> "PKR 5.5 Lakh". Any other currency is grouped in
 * thousands: "AED 1,550,000". The name is kept for the many existing callers.
 */
export function formatPkr(amount: number | undefined | null, currency: string = currentCurrency()): string {
  if (amount === undefined || amount === null) return '-';
  const code = normalizeCurrency(currency);
  if (!LAKH_CURRENCIES.has(code)) return `${code} ${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (amount >= 10_000_000) return `${code} ${+(amount / 10_000_000).toFixed(2)} Crore`;
  if (amount >= 100_000) return `${code} ${+(amount / 100_000).toFixed(2)} Lakh`;
  return `${code} ${amount.toLocaleString('en-PK')}`;
}
