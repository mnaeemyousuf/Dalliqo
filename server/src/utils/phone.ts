/**
 * Normalises phone numbers to E.164. Pakistani local formats are the common
 * case (03001234567, 3001234567, 0092300...), but any valid international
 * number in +<country><number> form is accepted. Returns null if invalid.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let digits = raw.replace(/[\s\-().]/g, '');

  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;

  if (!digits.startsWith('+')) {
    if (/^03\d{9}$/.test(digits)) return `+92${digits.slice(1)}`;
    if (/^3\d{9}$/.test(digits)) return `+92${digits}`;
    if (/^92\d{10}$/.test(digits)) return `+${digits}`;
    // Pakistani landline with area code, e.g. 0213xxxxxxx (Karachi).
    if (/^0[1-9]\d{8,9}$/.test(digits)) return `+92${digits.slice(1)}`;
    return null;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(digits)) return null;
  if (digits.startsWith('+92') && !/^\+92\d{9,10}$/.test(digits)) return null;
  return digits;
}

/** Digits-only form used for wa.me links. */
export function whatsappDigits(e164: string): string {
  return e164.replace(/^\+/, '');
}
