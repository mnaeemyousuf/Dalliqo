/**
 * Agreements (B3): sale, rent and token-receipt templates in English and Urdu, filled from the deal,
 * client, owner and property. The API renders and stores every version; the apps show those versions
 * (a draft created offline is rendered by the API when it syncs).
 */

export const AGREEMENT_KINDS = ['SALE', 'RENT', 'TOKEN_RECEIPT', 'OTHER'] as const;
export type AgreementKind = (typeof AGREEMENT_KINDS)[number];

export const AGREEMENT_LANGUAGES = ['en', 'ur'] as const;
export type AgreementLanguage = (typeof AGREEMENT_LANGUAGES)[number];

export const AGREEMENT_STATUSES = ['DRAFT', 'SENT', 'SIGNED', 'EXPIRED', 'CANCELLED'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/** Allowed status moves. SIGNED / CANCELLED / EXPIRED agreements are locked (no edits, no new versions). */
export const AGREEMENT_TRANSITIONS: Record<AgreementStatus, readonly AgreementStatus[]> = {
  DRAFT: ['SENT', 'SIGNED', 'CANCELLED'],
  SENT: ['DRAFT', 'SIGNED', 'CANCELLED'],
  SIGNED: ['EXPIRED', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
};
export const isAgreementLocked = (s: AgreementStatus) => s === 'SIGNED' || s === 'EXPIRED' || s === 'CANCELLED';

/** Rent agreements get renewal follow-ups this many days before the end date. */
export const AGREEMENT_RENEWAL_DAYS = [30, 7] as const;

/** Shown on every agreement screen and printed in every PDF footer. */
export const AGREEMENT_DISCLAIMER = {
  en: 'Template only, not legal advice. Have a qualified lawyer review this agreement before anyone signs it, and use the stamp paper required in your province.',
  ur: 'یہ صرف ایک نمونہ ہے، قانونی مشورہ نہیں۔ دستخط سے پہلے کسی مستند وکیل سے اس معاہدے کا جائزہ لازمی کروائیں اور اپنے صوبے کے مطابق اسٹامپ پیپر استعمال کریں۔',
} as const;

/** Placeholders a template can use: {{name}}. Missing values print as a blank line to fill by hand. */
export const AGREEMENT_PLACEHOLDERS = [
  'agreementNo', 'date', 'businessName', 'city',
  'clientName', 'clientMobile', 'clientAddress', 'clientCnic',
  'ownerName', 'ownerMobile', 'ownerAddress', 'ownerCnic',
  'propertyId', 'propertyAddress', 'propertySize', 'propertyType',
  'amount', 'amountWords', 'tokenAmount', 'balanceAmount', 'monthlyRent', 'securityDeposit',
  'startDate', 'endDate', 'durationMonths', 'witness1', 'witness2',
] as const;
export type AgreementPlaceholder = (typeof AGREEMENT_PLACEHOLDERS)[number];
export type AgreementValues = Partial<Record<AgreementPlaceholder, string | number | null | undefined>>;

/** Labels printed inside agreements (property type and size unit) in each language. */
export const AGREEMENT_LABELS = {
  propertyType: {
    en: { RESIDENTIAL_PLOT: 'residential plot', HOUSE: 'house', FLAT: 'flat', APARTMENT: 'apartment', PORTION: 'portion', SHOP: 'shop', OFFICE: 'office', COMMERCIAL: 'commercial property', OTHER: 'property' },
    ur: { RESIDENTIAL_PLOT: 'رہائشی پلاٹ', HOUSE: 'مکان', FLAT: 'فلیٹ', APARTMENT: 'اپارٹمنٹ', PORTION: 'پورشن', SHOP: 'دکان', OFFICE: 'دفتر', COMMERCIAL: 'کمرشل جائیداد', OTHER: 'جائیداد' },
  },
  sizeUnit: {
    en: { SQ_FT: 'sq ft', SQ_YARD: 'sq yards', SQ_METER: 'sq metres', MARLA: 'marla', KANAL: 'kanal' },
    ur: { SQ_FT: 'مربع فٹ', SQ_YARD: 'مربع گز', SQ_METER: 'مربع میٹر', MARLA: 'مرلہ', KANAL: 'کنال' },
  },
} as const satisfies Record<string, Record<AgreementLanguage, Record<string, string>>>;

export const AGREEMENT_BLANK = '________________';

/** Fills {{placeholders}}; unknown or empty ones become a blank line. */
export function renderAgreement(body: string, values: AgreementValues): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g, (_, key: string) => {
    const v = (values as Record<string, unknown>)[key];
    return v === undefined || v === null || v === '' ? AGREEMENT_BLANK : String(v);
  });
}

/** Placeholders used in a template body (for the template editor). */
export function placeholdersIn(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g)].map((m) => m[1]))];
}

/** "Rs 5,000,000" in the agreement's language (Western digits in both, as printed on stamp paper). */
export function agreementMoney(n: number | null | undefined, language: AgreementLanguage): string {
  if (n === null || n === undefined) return '';
  const s = Math.round(n).toLocaleString('en-PK');
  return language === 'ur' ? `${s} روپے` : `Rs ${s}`;
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ''}`;
  return [h ? `${ONES[h]} hundred` : '', rest].filter(Boolean).join(' ');
}

/** Amount in words, Pakistani style (crore / lakh / thousand): 25,50,000 → "twenty-five lakh fifty thousand rupees only". */
export function amountInWords(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '';
  let v = Math.round(n);
  if (v === 0) return 'zero rupees only';
  const parts: string[] = [];
  for (const [size, name] of [[10_000_000, 'crore'], [100_000, 'lakh'], [1000, 'thousand']] as const) {
    const q = Math.floor(v / size);
    if (q) parts.push(`${q >= 1000 ? amountInWords(q).replace(/ rupees only$/, '') : under1000(q)} ${name}`);
    v %= size;
  }
  if (v) parts.push(under1000(v));
  return `${parts.join(' ')} rupees only`;
}

export interface BuiltInTemplate {
  key: string;
  name: string;
  kind: AgreementKind;
  language: AgreementLanguage;
  body: string;
}

const SALE_EN = `AGREEMENT TO SELL
Agreement No. {{agreementNo}} · Date: {{date}} · {{city}}

This agreement is made between {{ownerName}} (CNIC {{ownerCnic}}, mobile {{ownerMobile}}, address {{ownerAddress}}), hereinafter the SELLER, and {{clientName}} (CNIC {{clientCnic}}, mobile {{clientMobile}}, address {{clientAddress}}), hereinafter the PURCHASER.

1. Property. The Seller agrees to sell and the Purchaser agrees to buy the {{propertyType}} known as {{propertyAddress}} (reference {{propertyId}}), measuring {{propertySize}}, with all rights attached to it.

2. Price. The total sale price is {{amount}} ({{amountWords}}).

3. Earnest money. The Purchaser has paid {{tokenAmount}} today as earnest money (bayana), which the Seller acknowledges. The balance of {{balanceAmount}} will be paid at the time of transfer.

4. Transfer. The transfer will be completed on or before {{endDate}} at the relevant society / registration office. The Seller will hand over vacant possession and the original documents at transfer.

5. Title. The Seller declares that the property is free of every charge, mortgage, lien and dispute, and will clear all dues (utility bills, society charges and taxes) up to the date of transfer.

6. Default. If the Purchaser fails to pay the balance on time, the earnest money is forfeited. If the Seller backs out, the Seller will return double the earnest money.

7. Costs. Transfer fee, stamp duty and other government charges will be paid as agreed between the parties or as per local practice.

Facilitated by {{businessName}}.

SELLER: ____________________        PURCHASER: ____________________

Witness 1: {{witness1}}        Witness 2: {{witness2}}`;

const SALE_UR = `اقرار نامہ بیع
معاہدہ نمبر {{agreementNo}} · تاریخ: {{date}} · {{city}}

یہ معاہدہ {{ownerName}} (شناختی کارڈ {{ownerCnic}}، موبائل {{ownerMobile}}، پتہ {{ownerAddress}}) جسے آگے بائع کہا جائے گا، اور {{clientName}} (شناختی کارڈ {{clientCnic}}، موبائل {{clientMobile}}، پتہ {{clientAddress}}) جسے آگے مشتری کہا جائے گا، کے درمیان طے پایا۔

1۔ جائیداد: بائع {{propertyType}} واقع {{propertyAddress}} (حوالہ {{propertyId}})، رقبہ {{propertySize}}، اس کے تمام حقوق سمیت فروخت کرنے اور مشتری خریدنے پر رضامند ہیں۔

2۔ قیمت: کل قیمت فروخت {{amount}} ہے۔

3۔ بیعانہ: مشتری نے آج {{tokenAmount}} بطور بیعانہ ادا کیے جو بائع نے وصول کر لیے۔ باقی رقم {{balanceAmount}} انتقال کے وقت ادا کی جائے گی۔

4۔ انتقال: انتقال {{endDate}} تک متعلقہ سوسائٹی / رجسٹری دفتر میں مکمل کیا جائے گا۔ بائع انتقال کے وقت خالی قبضہ اور اصل کاغذات حوالے کرے گا۔

5۔ ملکیت: بائع اقرار کرتا ہے کہ جائیداد ہر قسم کے رہن، قرض اور تنازع سے پاک ہے اور انتقال کی تاریخ تک تمام واجبات (بل، سوسائٹی چارجز، ٹیکس) ادا کرے گا۔

6۔ خلاف ورزی: اگر مشتری وقت پر باقی رقم ادا نہ کرے تو بیعانہ ضبط ہو جائے گا۔ اگر بائع معاہدے سے پھر جائے تو بیعانہ کی دگنی رقم واپس کرے گا۔

7۔ اخراجات: ٹرانسفر فیس، اسٹامپ ڈیوٹی اور دیگر سرکاری اخراجات فریقین کے باہمی اتفاق یا مقامی رواج کے مطابق ادا ہوں گے۔

بتوسط {{businessName}}۔

بائع: ____________________        مشتری: ____________________

گواہ 1: {{witness1}}        گواہ 2: {{witness2}}`;

const RENT_EN = `TENANCY AGREEMENT
Agreement No. {{agreementNo}} · Date: {{date}} · {{city}}

This tenancy agreement is made between {{ownerName}} (CNIC {{ownerCnic}}, mobile {{ownerMobile}}), hereinafter the LANDLORD, and {{clientName}} (CNIC {{clientCnic}}, mobile {{clientMobile}}), hereinafter the TENANT.

1. Premises. The Landlord lets the {{propertyType}} at {{propertyAddress}} (reference {{propertyId}}), measuring {{propertySize}}, to the Tenant for residential / commercial use only as agreed.

2. Term. The tenancy runs for {{durationMonths}} months from {{startDate}} to {{endDate}}. It can be renewed by mutual written agreement.

3. Rent. The monthly rent is {{monthlyRent}}, payable in advance by the 5th of every month.

4. Security deposit. The Tenant has paid a refundable security deposit of {{securityDeposit}}, to be returned at the end of the tenancy after deducting any unpaid bills or damage beyond normal wear.

5. Bills. Electricity, gas, water and other utility bills for the tenancy period will be paid by the Tenant.

6. Use and care. The Tenant will not sublet, make structural changes or use the premises for any unlawful purpose, and will hand the premises back in the same condition.

7. Notice. Either party may end the tenancy with one month's written notice. The Tenant will provide a copy of their CNIC for police registration as required by law.

Facilitated by {{businessName}}.

LANDLORD: ____________________        TENANT: ____________________

Witness 1: {{witness1}}        Witness 2: {{witness2}}`;

const RENT_UR = `کرایہ نامہ
معاہدہ نمبر {{agreementNo}} · تاریخ: {{date}} · {{city}}

یہ کرایہ نامہ {{ownerName}} (شناختی کارڈ {{ownerCnic}}، موبائل {{ownerMobile}}) جسے آگے مالک مکان کہا جائے گا، اور {{clientName}} (شناختی کارڈ {{clientCnic}}، موبائل {{clientMobile}}) جسے آگے کرایہ دار کہا جائے گا، کے درمیان طے پایا۔

1۔ جگہ: مالک مکان {{propertyType}} واقع {{propertyAddress}} (حوالہ {{propertyId}})، رقبہ {{propertySize}}، کرایہ دار کو طے شدہ استعمال کے لیے کرایہ پر دیتا ہے۔

2۔ مدت: کرایہ داری {{durationMonths}} ماہ کے لیے {{startDate}} سے {{endDate}} تک ہوگی۔ باہمی تحریری رضامندی سے تجدید ہو سکتی ہے۔

3۔ کرایہ: ماہانہ کرایہ {{monthlyRent}} ہے جو ہر ماہ کی 5 تاریخ تک پیشگی ادا کیا جائے گا۔

4۔ زر ضمانت: کرایہ دار نے {{securityDeposit}} بطور قابل واپسی زر ضمانت ادا کیے جو مدت ختم ہونے پر بقایا بل یا نقصان منہا کر کے واپس کیے جائیں گے۔

5۔ بل: کرایہ داری کی مدت کے بجلی، گیس، پانی اور دیگر بل کرایہ دار ادا کرے گا۔

6۔ استعمال: کرایہ دار جگہ آگے کرایہ پر نہیں دے گا، تعمیری تبدیلی نہیں کرے گا، غیر قانونی استعمال نہیں کرے گا اور جگہ اسی حالت میں واپس کرے گا۔

7۔ نوٹس: کوئی بھی فریق ایک ماہ کے تحریری نوٹس سے کرایہ داری ختم کر سکتا ہے۔ کرایہ دار قانون کے مطابق پولیس اندراج کے لیے شناختی کارڈ کی نقل فراہم کرے گا۔

بتوسط {{businessName}}۔

مالک مکان: ____________________        کرایہ دار: ____________________

گواہ 1: {{witness1}}        گواہ 2: {{witness2}}`;

const TOKEN_EN = `TOKEN (BAYANA) RECEIPT
Receipt No. {{agreementNo}} · Date: {{date}} · {{city}}

I, {{ownerName}} (CNIC {{ownerCnic}}), owner of the {{propertyType}} at {{propertyAddress}} (reference {{propertyId}}), measuring {{propertySize}}, acknowledge that I have received {{tokenAmount}} from {{clientName}} (CNIC {{clientCnic}}, mobile {{clientMobile}}) as token money for the sale of this property.

The total agreed price is {{amount}} ({{amountWords}}). The balance of {{balanceAmount}} is to be paid by {{endDate}}, when a full agreement to sell will be signed.

If the buyer does not proceed, the token money is forfeited. If the seller does not proceed, the seller will return double the token money.

Facilitated by {{businessName}}.

Received by (SELLER): ____________________        Paid by (BUYER): ____________________

Witness 1: {{witness1}}        Witness 2: {{witness2}}`;

const TOKEN_UR = `رسید بیعانہ
رسید نمبر {{agreementNo}} · تاریخ: {{date}} · {{city}}

میں {{ownerName}} (شناختی کارڈ {{ownerCnic}})، مالک {{propertyType}} واقع {{propertyAddress}} (حوالہ {{propertyId}})، رقبہ {{propertySize}}، اقرار کرتا ہوں کہ میں نے {{clientName}} (شناختی کارڈ {{clientCnic}}، موبائل {{clientMobile}}) سے اس جائیداد کی فروخت کے لیے {{tokenAmount}} بطور بیعانہ وصول کیے۔

کل طے شدہ قیمت {{amount}} ہے۔ باقی رقم {{balanceAmount}} تاریخ {{endDate}} تک ادا کی جائے گی جب مکمل اقرار نامہ بیع پر دستخط ہوں گے۔

اگر خریدار سودا نہ کرے تو بیعانہ ضبط ہو جائے گا۔ اگر فروخت کنندہ سودا نہ کرے تو بیعانہ کی دگنی رقم واپس کرے گا۔

بتوسط {{businessName}}۔

وصول کنندہ (بائع): ____________________        ادا کنندہ (مشتری): ____________________

گواہ 1: {{witness1}}        گواہ 2: {{witness2}}`;

/** Seeded for every business (they can be copied and edited; built-ins themselves can be archived, not changed). */
export const BUILT_IN_AGREEMENT_TEMPLATES: readonly BuiltInTemplate[] = [
  { key: 'SALE_EN', name: 'Agreement to sell', kind: 'SALE', language: 'en', body: SALE_EN },
  { key: 'SALE_UR', name: 'اقرار نامہ بیع', kind: 'SALE', language: 'ur', body: SALE_UR },
  { key: 'RENT_EN', name: 'Tenancy agreement', kind: 'RENT', language: 'en', body: RENT_EN },
  { key: 'RENT_UR', name: 'کرایہ نامہ', kind: 'RENT', language: 'ur', body: RENT_UR },
  { key: 'TOKEN_EN', name: 'Token (bayana) receipt', kind: 'TOKEN_RECEIPT', language: 'en', body: TOKEN_EN },
  { key: 'TOKEN_UR', name: 'رسید بیعانہ', kind: 'TOKEN_RECEIPT', language: 'ur', body: TOKEN_UR },
];
