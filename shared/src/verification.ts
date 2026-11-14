/**
 * Internal property verification. A business checks the documents and facts of a listing before
 * marketing it. This is an internal review only — never a government confirmation of ownership —
 * and every screen that shows the result must say so (VERIFICATION_DISCLAIMER_KEY).
 */

export const VERIFICATION_STATUSES = ['NOT_SUBMITTED', 'PENDING', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_DECISIONS = ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

/** Checklist the verification officer works through; each item may need a document category. */
export const VERIFICATION_CHECKLIST: readonly { key: string; documents?: readonly string[] }[] = [
  { key: 'OWNER_IDENTITY', documents: ['CNIC'] },
  { key: 'OWNERSHIP_PROOF', documents: ['OWNERSHIP', 'REGISTRY', 'ALLOTMENT_LETTER', 'TRANSFER_LETTER'] },
  { key: 'SOCIETY_NOC', documents: ['SOCIETY_NOC'] },
  { key: 'PROPERTY_TAX', documents: ['PROPERTY_TAX'] },
  { key: 'DUES_CLEARED', documents: ['DUES_RECORD'] },
  { key: 'POSSESSION_CONFIRMED', documents: ['POSSESSION'] },
  { key: 'SITE_INSPECTED' },
  { key: 'PRICE_CONFIRMED' },
];

/** Document categories holding personal or legal data (CNIC, title documents). */
export const SENSITIVE_DOCUMENT_CATEGORIES = ['IDENTITY', 'CNIC', 'OWNERSHIP', 'REGISTRY', 'ALLOTMENT_LETTER', 'TRANSFER_LETTER'] as const;

export const isSensitiveCategory = (c?: string | null) => !!c && (SENSITIVE_DOCUMENT_CATEGORIES as readonly string[]).includes(c);

/** Days after approval until the next verification is due, when the officer does not pick a date. */
export const DEFAULT_REVERIFY_DAYS = 180;

export const VERIFICATION_DISCLAIMER_KEY = 'verification.disclaimer';

/** Pakistani CNIC: 13 digits shown as 12345-1234567-1. */
export function formatCnic(raw?: string | null): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length !== 13) return raw ?? '';
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

/** Masked for people without access to sensitive data: 12345-*******-1. */
export function maskCnic(raw?: string | null): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length !== 13) return raw ? '•••••' : '';
  return `${d.slice(0, 5)}-*******-${d.slice(12)}`;
}

export const isValidCnic = (raw: string) => /^\d{5}-?\d{7}-?\d$/.test(raw.trim());
