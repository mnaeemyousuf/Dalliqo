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

/** "15500000" -> "1.55 Crore", "550000" -> "5.5 Lakh" (Pakistani numbering). */
export function formatPkr(amount: number | undefined | null): string {
  if (amount === undefined || amount === null) return '-';
  if (amount >= 10_000_000) return `PKR ${+(amount / 10_000_000).toFixed(2)} Crore`;
  if (amount >= 100_000) return `PKR ${+(amount / 100_000).toFixed(2)} Lakh`;
  return `PKR ${amount.toLocaleString('en-PK')}`;
}
