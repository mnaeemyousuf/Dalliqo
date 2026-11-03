/** Income & expense tracking (B2). */

export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** MANUAL entries are typed in; COMMISSION entries are created from commission payments on deals. */
export const TRANSACTION_SOURCES = ['MANUAL', 'COMMISSION'] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export interface DefaultTransactionCategory {
  key: string;
  name: string;
  nameUr: string;
  type: TransactionType;
}

/** Built-in categories seeded for every business (custom ones can be added; built-ins can be archived). */
export const DEFAULT_TRANSACTION_CATEGORIES: readonly DefaultTransactionCategory[] = [
  { key: 'COMMISSION', name: 'Commission', nameUr: 'کمیشن', type: 'INCOME' },
  { key: 'RENT_COLLECTION', name: 'Rent collection fee', nameUr: 'کرایہ وصولی فیس', type: 'INCOME' },
  { key: 'CONSULTANCY', name: 'Consultancy', nameUr: 'مشاورت', type: 'INCOME' },
  { key: 'OTHER_INCOME', name: 'Other income', nameUr: 'دیگر آمدنی', type: 'INCOME' },
  { key: 'OFFICE_RENT', name: 'Office rent', nameUr: 'دفتر کا کرایہ', type: 'EXPENSE' },
  { key: 'SALARIES', name: 'Salaries', nameUr: 'تنخواہیں', type: 'EXPENSE' },
  { key: 'UTILITIES', name: 'Utilities', nameUr: 'یوٹیلیٹی بل', type: 'EXPENSE' },
  { key: 'MARKETING', name: 'Marketing & ads', nameUr: 'تشہیر', type: 'EXPENSE' },
  { key: 'FUEL_TRAVEL', name: 'Fuel & travel', nameUr: 'پیٹرول اور سفر', type: 'EXPENSE' },
  { key: 'AGENT_PAYOUT', name: 'Agent payouts', nameUr: 'ایجنٹ ادائیگیاں', type: 'EXPENSE' },
  { key: 'OTHER_EXPENSE', name: 'Other expense', nameUr: 'دیگر اخراجات', type: 'EXPENSE' },
];
