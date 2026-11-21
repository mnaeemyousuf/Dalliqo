import i18n from '@/i18n';

const locale = () => (i18n.language === 'ur' ? 'ur-PK' : 'en-PK');

/**
 * The business's display settings. Set from the signed-in business (auth store) or, on public
 * pages, from the site / portal owner. PKR and Asia/Karachi until then.
 */
const region = { currency: 'PKR', timezone: 'Asia/Karachi' };

export function setRegion(next: { currency?: string | null; timezone?: string | null }): void {
  const c = (next.currency ?? '').trim().toUpperCase();
  region.currency = /^[A-Z]{3}$/.test(c) ? c : 'PKR';
  region.timezone = next.timezone && isValidTimeZone(next.timezone) ? next.timezone : 'Asia/Karachi';
}

export const currentCurrency = () => region.currency;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The link if it is a plain web (http/https) address, otherwise undefined — never a javascript: or data: link. */
export function safeHttpUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Currencies written with lakh / crore (South Asian numbering). */
const LAKH_CURRENCIES = new Set(['PKR', 'INR', 'BDT', 'NPR', 'LKR']);

/**
 * Money in the business's currency. Pakistani numbering for PKR: 15,500,000 → "PKR 1.55 Crore",
 * 550,000 → "PKR 5.5 Lakh" (Urdu: روپے). Other currencies are grouped in thousands: "AED 1,550,000".
 */
export function formatPkr(amount?: number | null, withCurrency = true): string {
  if (amount === undefined || amount === null) return '—';
  const ur = i18n.language === 'ur';
  const code = region.currency;
  if (!LAKH_CURRENCIES.has(code)) return `${withCurrency ? `${code} ` : ''}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const prefix = withCurrency ? (ur && code === 'PKR' ? 'روپے ' : `${code} `) : '';
  if (amount >= 10_000_000) return `${prefix}${+(amount / 10_000_000).toFixed(2)} ${ur ? 'کروڑ' : 'Crore'}`;
  if (amount >= 100_000) return `${prefix}${+(amount / 100_000).toFixed(2)} ${ur ? 'لاکھ' : 'Lakh'}`;
  return `${prefix}${amount.toLocaleString('en-PK')}`;
}

/** "PKR 1.2 – 1.6 Crore" when both ends share a unit, otherwise each end in full. */
export function formatRange(min?: number | null, max?: number | null): string {
  if (!min && !max) return '—';
  if (min && max) {
    const unitOf = (n: number) => (n >= 10_000_000 ? 1e7 : n >= 100_000 ? 1e5 : 1);
    const u = unitOf(max);
    if (u > 1 && unitOf(min) === u && LAKH_CURRENCIES.has(region.currency)) {
      const full = formatPkr(max);
      const head = +(min / u).toFixed(2);
      // formatPkr(max) = "PKR <n> <Unit>"; insert the lower bound before the number.
      return full.replace(/([\d.]+)/, `${head} – $1`);
    }
    return `${formatPkr(min)} – ${formatPkr(max)}`;
  }
  return min ? `≥ ${formatPkr(min)}` : `≤ ${formatPkr(max)}`;
}

export function formatDate(value?: string | Date | null, withTime = false): string {
  if (!value) return '—';
  const d = new Date(value);
  return new Intl.DateTimeFormat(locale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: region.timezone,
  }).format(d);
}

export function formatTime(value?: string | Date | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', timeZone: region.timezone }).format(new Date(value));
}

export function relativeTime(value: string | Date): string {
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(value);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** For <input type="datetime-local"> in the user's local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const digits = (phone?: string) => (phone ?? '').replace(/\D/g, '');
export const telHref = (phone?: string) => `tel:${phone ?? ''}`;
export const waHref = (phone?: string, text?: string) => `https://wa.me/${digits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const smsHref = (phone?: string) => `sms:${phone ?? ''}`;
export const mailHref = (email?: string) => `mailto:${email ?? ''}`;

/** "a, b , c" → ["a","b","c"] */
export const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
