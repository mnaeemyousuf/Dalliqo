import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import ur from '@/i18n/ur.json';
import { formatPkr, formatRange, splitList, waHref } from '@/lib/format';
import { parseCoordinates } from '@/pages/PropertyPages';

function keys(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
}
const at = (o: Record<string, unknown>, k: string) => k.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown>)[p], o) as string;

describe('translations', () => {
  it('Urdu has exactly the same keys as English', () => {
    expect(keys(ur).sort()).toEqual(keys(en).sort());
  });

  it('keeps interpolation placeholders in Urdu', () => {
    const placeholders = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort();
    for (const k of keys(en)) expect(placeholders(at(ur, k))).toEqual(placeholders(at(en, k)));
  });
});

describe('PKR formatting', () => {
  it.each([
    [15_500_000, 'PKR 1.55 Crore'],
    [550_000, 'PKR 5.5 Lakh'],
    [75_000, 'PKR 75,000'],
  ])('%d -> %s', (n, s) => expect(formatPkr(n)).toBe(s));

  it('compacts ranges that share a unit', () => {
    expect(formatRange(12_000_000, 16_000_000)).toBe('PKR 1.2 – 1.6 Crore');
    expect(formatRange(5_000_000, 16_000_000)).toBe('PKR 50 Lakh – PKR 1.6 Crore');
    expect(formatRange(undefined, 16_000_000)).toBe('≤ PKR 1.6 Crore');
    expect(formatRange()).toBe('—');
  });
});

describe('helpers', () => {
  it('parses coordinates and Google Maps links', () => {
    expect(parseCoordinates('24.9204, 67.0932')).toEqual({ lat: 24.9204, lng: 67.0932 });
    expect(parseCoordinates('https://www.google.com/maps/@24.8008,67.0645,15z')).toEqual({ lat: 24.8008, lng: 67.0645 });
    expect(parseCoordinates('https://maps.google.com/?q=24.81%2C67.03')).toEqual({ lat: 24.81, lng: 67.03 });
    expect(parseCoordinates('Gulshan-e-Iqbal')).toBeNull();
  });

  it('builds WhatsApp links from E.164 numbers', () => {
    expect(waHref('+923001234567', 'Salam')).toBe('https://wa.me/923001234567?text=Salam');
  });

  it('splits comma lists', () => {
    expect(splitList(' DHA , Clifton,, ')).toEqual(['DHA', 'Clifton']);
  });
});
