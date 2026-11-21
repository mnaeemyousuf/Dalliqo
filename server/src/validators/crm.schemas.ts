import { z } from 'zod';
import {
  CLIENT_PURPOSES,
  CLIENT_SOURCES,
  COMMISSION_MODES,
  COMMISSION_STATUSES,
  DEAL_SIDES,
  DEAL_STAGES,
  PAYMENT_METHODS,
  PAYOUT_STATUSES,
  CLIENT_STATUSES,
  COMMUNICATION_CHANNELS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_ENTITY_TYPES,
  ENTITY_TYPES,
  FOLLOWUP_STATUSES,
  FOLLOWUP_TYPES,
  LISTING_PURPOSES,
  MATCH_STATUSES,
  NOTIFICATION_CATEGORIES,
  PRIORITIES,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  SIZE_UNITS,
  TRANSACTION_TYPES,
  AGREEMENT_KINDS,
  AGREEMENT_LANGUAGES,
  AGREEMENT_STATUSES,
} from '@recrm/shared';
import { email, objectId, pagination, personName, phone } from './common';
import {
  AUTOMATION_RULE_KEYS,
  BUYING_TIMELINES,
  CONSTRUCTION_STATUSES,
  DEVELOPMENT_STATUSES,
  FACING_DIRECTIONS,
  FURNISHING_STATUSES,
  LEAD_SCORE_FACTORS,
  LEAD_TEMPERATURES,
  LOST_REASONS,
  OFFER_PARTIES,
  POSSESSION_STATUSES,
  PROPERTY_CATEGORIES,
  VERIFICATION_DECISIONS,
  VERIFICATION_STATUSES,
  LATE_FEE_TYPES,
  EXTERNAL_SHARE_KINDS,
  INSTALLMENT_FREQUENCIES,
  LEASE_STATUSES,
  INSPECTION_TYPES,
} from '@recrm/shared';

const uuid = z.string().uuid();
const money = z.coerce.number().int('Amounts are whole rupees').min(0).max(1e12);
const size = z.coerce.number().positive().max(1e7);
const shortText = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => shortText(max).optional().transform((v) => (v === '' ? undefined : v));
const nullableId = objectId.nullable();
/** Accepts a server ObjectId or (from offline sync) a device uuid. */
const ref = z.union([objectId, uuid]);
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
const list = <T extends z.ZodTypeAny>(item: T) =>
  z.union([z.array(item), z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))]).pipe(z.array(item));

// ── Branches ──
const branchFields = {
  name: shortText(80).min(2),
  nameUr: optionalText(80),
  code: optionalText(12),
  address: optionalText(300),
  phone: phone.optional(),
  targets: z.object({ leads: z.number().int().min(0).max(1e6).nullable().optional(), dealsWon: z.number().int().min(0).max(1e5).nullable().optional(), commission: money.nullable().optional() }).strict().optional(),
};
export const branchCreateSchema = z.object({ uuid: uuid.optional(), ...branchFields }).strict();
export const branchUpdateSchema = z
  .object(branchFields)
  .partial()
  .extend({ archived: z.boolean().optional(), baseVersion: z.number().int().positive().optional() })
  .strict();
export const branchListQuery = z.object({ includeArchived: bool.optional() });
/** Optional branch on branch-scoped records (defaults to the selected / member's / main branch). */
const branchRef = objectId.optional();

// ── Categories ──
export const categoryCreateSchema = z.object({ uuid: uuid.optional(), name: shortText(80).min(2), nameUr: optionalText(80), sortOrder: z.number().int().optional() }).strict();
export const categoryUpdateSchema = z
  .object({ name: shortText(80).min(2).optional(), nameUr: optionalText(80), sortOrder: z.number().int().optional(), archived: z.boolean().optional() })
  .strict();
export const categoryListQuery = z.object({ includeArchived: bool.optional() });

// ── Clients ──
export const requirementSchema = z
  .object({
    _id: objectId.optional(),
    isPrimary: z.boolean().optional(),
    active: z.boolean().optional(),
    purpose: z.enum(CLIENT_PURPOSES),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(20).optional(),
    areas: z.array(shortText(120)).max(10).optional(),
    societies: z.array(shortText(120)).max(10).optional(),
    blocks: z.array(shortText(60)).max(20).optional(),
    minSize: size.optional(),
    maxSize: size.optional(),
    sizeUnit: z.enum(SIZE_UNITS).optional(),
    minBudget: money.optional(),
    maxBudget: money.optional(),
    bedroomsMin: z.number().int().min(0).max(50).optional(),
    bathroomsMin: z.number().int().min(0).max(50).optional(),
    constructionStatuses: z.array(z.enum(CONSTRUCTION_STATUSES)).max(10).optional(),
    possessionStatuses: z.array(z.enum(POSSESSION_STATUSES)).max(10).optional(),
    amenities: z.array(shortText(60)).max(20).optional(),
    notes: optionalText(1000),
  })
  .strict();

const clientFields = {
  branchId: branchRef,
  fullName: personName,
  mobileNumber: phone,
  alternateNumber: phone.optional(),
  whatsappNumber: phone.optional(),
  email: email.optional(),
  address: optionalText(500),
  categoryId: ref.optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  source: z.enum(CLIENT_SOURCES).optional(),
  assignedTo: objectId.optional(),
  notes: optionalText(2000),
  requirements: z.array(requirementSchema).max(10).optional(),
  // Flat shorthand from the spec's client model.
  preferredArea: optionalText(120),
  preferredSociety: optionalText(120),
  preferredBlock: optionalText(60),
  propertyTypeRequired: z.array(z.enum(PROPERTY_TYPES)).optional(),
  minSize: size.optional(),
  maxSize: size.optional(),
  sizeUnit: z.enum(SIZE_UNITS).optional(),
  minBudget: money.optional(),
  maxBudget: money.optional(),
  purchaseOrRental: z.enum(CLIENT_PURPOSES).optional(),
  campaign: optionalText(120),
  buyingTimeline: z.enum(BUYING_TIMELINES).optional(),
  temperatureOverride: z.enum(LEAD_TEMPERATURES).nullable().optional(),
  lostReason: z.enum(LOST_REASONS).optional(),
  lostNote: optionalText(500),
};

export const clientCreateSchema = z.object({ uuid: uuid.optional(), allowDuplicate: z.boolean().optional(), ...clientFields }).strict();
export const duplicateClientQuery = z.object({ phone: z.union([phone, z.array(phone).max(3)]), excludeId: objectId.optional() });
export const clientUpdateSchema = z.object(clientFields).partial().extend({ baseVersion: z.number().int().positive().optional() }).strict();

export const clientListQuery = pagination.extend({
  q: optionalText(100),
  branchId: objectId.optional(),
  categoryId: objectId.optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedTo: objectId.optional(),
  area: optionalText(120),
  society: optionalText(120),
  block: optionalText(60),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  purpose: z.enum(CLIENT_PURPOSES).optional(),
  minBudget: money.optional(),
  maxBudget: money.optional(),
  minSize: size.optional(),
  maxSize: size.optional(),
  sizeUnit: z.enum(SIZE_UNITS).optional(),
  unassigned: bool.optional(),
  source: z.enum(CLIENT_SOURCES).optional(),
  temperature: z.enum(LEAD_TEMPERATURES).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  staleDays: z.coerce.number().int().min(1).max(365).optional(),
  sort: z.enum(['-updatedAt', '-createdAt', 'createdAt', 'fullName', '-matchCount', '-maxBudget', '-leadScore']).optional(),
});
export const leadAssignSchema = z.object({ userId: objectId.nullable(), note: optionalText(300) }).strict();
export const leadReportQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), assignedTo: objectId.optional() });
export const leadImportFields = z.object({ assignedTo: objectId.optional(), source: z.enum(CLIENT_SOURCES).optional() });

export const communicationSchema = z.object({ channel: z.enum(COMMUNICATION_CHANNELS), note: optionalText(300) }).strict();

// ── Owners ──
const ownerFields = {
  branchId: branchRef,
  fullName: personName,
  mobileNumber: phone,
  alternateNumber: phone.optional(),
  whatsappNumber: phone.optional(),
  email: email.optional(),
  address: optionalText(500),
  notes: optionalText(2000),
  cnic: z
    .string()
    .trim()
    .refine((v) => /^\d{5}-?\d{7}-?\d$/.test(v), { message: 'CNIC must be 13 digits (12345-1234567-1)' })
    .transform((v) => v.replace(/\D/g, ''))
    .optional(),
};
export const ownerCreateSchema = z.object({ uuid: uuid.optional(), ...ownerFields }).strict();
export const ownerUpdateSchema = z.object(ownerFields).partial().extend({ baseVersion: z.number().int().positive().optional() }).strict();
export const ownerListQuery = pagination.extend({ q: optionalText(100), branchId: objectId.optional(), sort: z.enum(['-updatedAt', 'fullName', '-propertyCount']).optional() });

// ── Properties ──
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const propertyFields = {
  branchId: branchRef,
  propertyType: z.enum(PROPERTY_TYPES),
  listingPurpose: z.enum(LISTING_PURPOSES).optional(),
  status: z.enum(PROPERTY_STATUSES).optional(),
  title: optionalText(150),
  area: optionalText(120),
  society: optionalText(120),
  block: optionalText(60),
  street: optionalText(120),
  plotNumber: optionalText(60),
  city: optionalText(80),
  size,
  sizeUnit: z.enum(SIZE_UNITS),
  askingPrice: money,
  expectedFinalPrice: money.optional(),
  minimumPrice: money.optional(),
  negotiable: z.boolean().optional(),
  ownerId: ref.nullable().optional(),
  description: optionalText(5000),
  latitude: lat.nullable().optional(),
  longitude: lng.nullable().optional(),
  // http(s) only: a javascript: or data: link would run script when someone clicks it.
  googleMapsUrl: z.string().trim().url().max(500).refine((v) => /^https?:\/\//i.test(v), { message: 'Use a web link (https://…)' }).optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  bathrooms: z.number().int().min(0).max(50).optional(),
  floors: z.number().int().min(0).max(200).optional(),
  phase: optionalText(60),
  sector: optionalText(60),
  unitNumber: optionalText(60),
  possessionStatus: z.enum(POSSESSION_STATUSES).optional(),
  developmentStatus: z.enum(DEVELOPMENT_STATUSES).optional(),
  constructionStatus: z.enum(CONSTRUCTION_STATUSES).optional(),
  furnishing: z.enum(FURNISHING_STATUSES).optional(),
  facing: z.enum(FACING_DIRECTIONS).optional(),
  corner: z.boolean().optional(),
  mainRoad: z.boolean().optional(),
  parkFacing: z.boolean().optional(),
  amenities: z.array(shortText(60)).max(30).optional(),
  availabilityExpiresAt: z.coerce.date().nullable().optional(),
  coOwnerIds: z.array(objectId).max(10).optional(),
  agentIds: z.array(objectId).max(10).optional(),
};
const coordsTogether = (v: { latitude?: number | null; longitude?: number | null }) =>
  (v.latitude === undefined) === (v.longitude === undefined) && (v.latitude === null) === (v.longitude === null);

export const propertyCreateSchema = z
  .object({ uuid: uuid.optional(), allowDuplicate: z.boolean().optional(), ...propertyFields })
  .strict()
  .refine(coordsTogether, { message: 'latitude and longitude must be provided together', path: ['latitude'] });
export const propertyUpdateSchema = z
  .object(propertyFields)
  .partial()
  .extend({ baseVersion: z.number().int().positive().optional() })
  .strict()
  .refine(coordsTogether, { message: 'latitude and longitude must be provided together', path: ['latitude'] });

export const propertyVerifySchema = z.object({ note: optionalText(300) }).strict();
export const propertyStatusSchema = z.object({ status: z.enum(PROPERTY_STATUSES), reason: optionalText(300), baseVersion: z.number().int().positive().optional() }).strict();

export const propertyListQuery = pagination
  .extend({
    q: optionalText(100),
    branchId: objectId.optional(),
    propertyId: optionalText(20),
    propertyType: z.enum(PROPERTY_TYPES).optional(),
    status: z.enum(PROPERTY_STATUSES).optional(),
    listingPurpose: z.enum(LISTING_PURPOSES).optional(),
    area: optionalText(120),
    society: optionalText(120),
    block: optionalText(60),
    minPrice: money.optional(),
    maxPrice: money.optional(),
    minSize: size.optional(),
    maxSize: size.optional(),
    sizeUnit: z.enum(SIZE_UNITS).optional(),
    ownerId: objectId.optional(),
    verification: z.enum(['stale', 'fresh']).optional(),
    category: z.enum(PROPERTY_CATEGORIES).optional(),
    phase: optionalText(60),
    agentId: objectId.optional(),
    corner: bool.optional(),
    parkFacing: bool.optional(),
    mainRoad: bool.optional(),
    possessionStatus: z.enum(POSSESSION_STATUSES).optional(),
    constructionStatus: z.enum(CONSTRUCTION_STATUSES).optional(),
    furnishing: z.enum(FURNISHING_STATUSES).optional(),
    minBedrooms: z.coerce.number().int().min(0).max(50).optional(),
    expiringDays: z.coerce.number().int().min(0).max(365).optional(),
    lat: lat.optional(),
    lng: lng.optional(),
    radiusKm: z.coerce.number().positive().max(100).optional(),
    sort: z.enum(['-updatedAt', '-createdAt', 'askingPrice', '-askingPrice', 'sizeSqft', '-sizeSqft', '-matchCount', 'propertyId']).optional(),
  })
  .transform(({ lat: la, lng: lo, radiusKm, ...rest }) => ({
    ...rest,
    ...(la !== undefined && lo !== undefined ? { near: { lat: la, lng: lo, radiusKm: radiusKm ?? 2 } } : {}),
  }));

export const duplicatePropertyQuery = z.object({
  society: optionalText(120),
  block: optionalText(60),
  phase: optionalText(60),
  plotNumber: shortText(60).min(1),
  unitNumber: optionalText(60),
  excludeId: objectId.optional(),
});

// ── Deals & commission ──
export const offerSchema = z
  .object({ id: uuid.optional(), _id: uuid.optional(), party: z.enum(OFFER_PARTIES), amount: money.pipe(z.number().min(1)), note: optionalText(500), status: z.enum(['OPEN', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'WITHDRAWN']).optional(), at: z.coerce.date().optional() })
  .strict();
export const offerRespondSchema = z.object({ status: z.enum(['ACCEPTED', 'REJECTED', 'WITHDRAWN']) }).strict();
export const externalPaySchema = z.object({ amount: money.pipe(z.number().min(1)) }).strict();
export const dealApprovalSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: optionalText(500) }).strict();
export const checklistItemSchema = z.object({ key: shortText(60).min(1), label: optionalText(120), done: z.boolean() }).strict();
const commissionTerm = z.object({ mode: z.enum(COMMISSION_MODES), value: z.number().min(0).max(1e12) }).strict();
const agentShare = z.object({ userId: objectId, sharePct: z.number().gt(0).max(100) }).strict();
export const dealPaymentSchema = z
  .object({
    id: uuid.optional(),
    _id: uuid.optional(),
    side: z.enum(DEAL_SIDES),
    amount: money.pipe(z.number().min(1)),
    date: z.coerce.date(),
    method: z.enum(PAYMENT_METHODS).optional(),
    reference: optionalText(100),
    notes: optionalText(500),
  })
  .strict();
export const dealPayoutSchema = z
  .object({
    id: uuid.optional(),
    _id: uuid.optional(),
    userId: objectId,
    amount: money.pipe(z.number().min(1)),
    date: z.coerce.date().nullable().optional(),
    status: z.enum(PAYOUT_STATUSES).optional(),
    notes: optionalText(500),
  })
  .strict();
export const dealPayoutUpdateSchema = z
  .object({ amount: money.pipe(z.number().min(1)).optional(), date: z.coerce.date().nullable().optional(), status: z.enum(PAYOUT_STATUSES).optional(), notes: optionalText(500) })
  .strict();
const dealFields = {
  branchId: branchRef,
  title: optionalText(150),
  clientId: ref,
  propertyId: ref.nullable().optional(),
  agents: z.array(agentShare).min(1).max(10).optional(),
  agreedPrice: money.optional(),
  finalPrice: money.optional(),
  expectedCloseDate: z.coerce.date().nullable().optional(),
  notes: optionalText(2000),
  commission: z.object({ buyer: commissionTerm.optional(), seller: commissionTerm.optional() }).strict().optional(),
  tokenAmount: money.optional(),
  externalShares: z
    .array(z.object({ _id: z.string().max(64).optional(), id: z.string().max(64).optional(), kind: z.enum(EXTERNAL_SHARE_KINDS), name: shortText(120).min(2), mode: z.enum(COMMISSION_MODES), value: z.number().min(0).max(1e12), paid: money.optional() }).strict())
    .max(10)
    .optional(),
  offers: z.array(offerSchema).max(100).optional(),
  checklist: z.array(checklistItemSchema).max(50).optional(),
};
export const dealCreateSchema = z
  .object({ uuid: uuid.optional(), stage: z.enum(DEAL_STAGES).optional(), lostReason: optionalText(500), ...dealFields, payments: z.array(dealPaymentSchema).max(100).optional(), payouts: z.array(dealPayoutSchema).max(100).optional() })
  .strict();
export const dealUpdateSchema = z
  .object(dealFields)
  .partial()
  .extend({
    stage: z.enum(DEAL_STAGES).optional(),
    lostReason: optionalText(500),
    payments: z.array(dealPaymentSchema).max(100).optional(),
    payouts: z.array(dealPayoutSchema).max(100).optional(),
    baseVersion: z.number().int().positive().optional(),
  })
  .strict();
export const dealStageSchema = z.object({ stage: z.enum(DEAL_STAGES), note: optionalText(300), lostReason: optionalText(500), baseVersion: z.number().int().positive().optional() }).strict();
export const dealListQuery = pagination.extend({
  q: optionalText(100),
  stage: z.enum(DEAL_STAGES).optional(),
  open: bool.optional(),
  agentId: objectId.optional(),
  clientId: objectId.optional(),
  propertyId: objectId.optional(),
  commissionStatus: z.enum(COMMISSION_STATUSES).optional(),
  branchId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(['-updatedAt', '-createdAt', '-expectedTotal', '-outstanding', 'dealNo']).optional(),
});
export const commissionReportQuery = z.object({ groupBy: z.enum(['month', 'agent']).default('month'), from: z.coerce.date().optional(), to: z.coerce.date().optional() });
export const subIdParams = z.object({ id: objectId, subId: z.string().uuid() });

// ── Income & expense ──
const transactionFields = {
  branchId: branchRef,
  type: z.enum(TRANSACTION_TYPES),
  categoryId: objectId,
  amount: money.pipe(z.number().min(1)),
  date: z.coerce.date(),
  method: z.enum(PAYMENT_METHODS).optional(),
  dealId: objectId.nullable().optional(),
  propertyId: objectId.nullable().optional(),
  clientId: objectId.nullable().optional(),
  campaignId: objectId.nullable().optional(),
  leaseId: objectId.nullable().optional(),
  description: optionalText(500),
  reference: optionalText(100),
};
export const transactionCreateSchema = z.object({ uuid: uuid.optional(), ...transactionFields }).strict();
export const transactionUpdateSchema = z
  .object(transactionFields)
  .partial()
  .extend({ baseVersion: z.number().int().positive().optional() })
  .strict();
export const transactionListQuery = pagination.extend({
  q: optionalText(100),
  type: z.enum(TRANSACTION_TYPES).optional(),
  categoryId: objectId.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  dealId: objectId.optional(),
  branchId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export const transactionCategoryCreateSchema = z
  .object({ uuid: uuid.optional(), name: z.string().trim().min(1).max(80), nameUr: optionalText(80), type: z.enum(TRANSACTION_TYPES) })
  .strict();
export const transactionCategoryUpdateSchema = z
  .object({ name: z.string().trim().min(1).max(80).optional(), nameUr: optionalText(80), archived: z.boolean().optional() })
  .strict();
export const transactionCategoryListQuery = z.object({ includeArchived: bool.optional() });
// ── Agreements ──
const cnic = z.string().trim().max(20).regex(/^[\d-]*$/, 'CNIC digits and dashes only').optional().transform((v) => (v === '' ? undefined : v));
const agreementFields = {
  branchId: branchRef,
  templateId: objectId.nullable().optional(),
  kind: z.enum(AGREEMENT_KINDS),
  language: z.enum(AGREEMENT_LANGUAGES).optional(),
  title: optionalText(150),
  dealId: ref.nullable().optional(),
  clientId: ref,
  ownerId: ref.nullable().optional(),
  propertyId: ref.nullable().optional(),
  amount: money.nullable().optional(),
  tokenAmount: money.nullable().optional(),
  monthlyRent: money.nullable().optional(),
  securityDeposit: money.nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  clientCnic: cnic,
  ownerCnic: cnic,
  witness1: optionalText(150),
  witness2: optionalText(150),
  notes: optionalText(2000),
};
const datesInOrder = (v: { startDate?: Date | null; endDate?: Date | null }) => !v.startDate || !v.endDate || v.endDate > v.startDate;
export const agreementCreateSchema = z
  .object({ uuid: uuid.optional(), ...agreementFields })
  .strict()
  .refine(datesInOrder, { message: 'End date must be after the start date', path: ['endDate'] });
export const agreementUpdateSchema = z
  .object(agreementFields)
  .partial()
  .extend({ status: z.enum(AGREEMENT_STATUSES).optional(), baseVersion: z.number().int().positive().optional() })
  .strict()
  .refine(datesInOrder, { message: 'End date must be after the start date', path: ['endDate'] });
export const agreementListQuery = pagination.extend({
  q: optionalText(100),
  status: z.enum(AGREEMENT_STATUSES).optional(),
  kind: z.enum(AGREEMENT_KINDS).optional(),
  clientId: objectId.optional(),
  propertyId: objectId.optional(),
  dealId: objectId.optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
  branchId: objectId.optional(),
});
export const agreementStatusSchema = z.object({ status: z.enum(AGREEMENT_STATUSES), note: optionalText(300), signedDocumentId: objectId.optional() }).strict();
export const agreementRenderSchema = z.object({ templateId: objectId.optional() }).strict();
export const agreementVersionSchema = z.object({ body: z.string().trim().min(20).max(40_000) }).strict();
export const agreementPdfQuery = z.object({ version: z.coerce.number().int().positive().optional() });
export const agreementTemplateCreateSchema = z
  .object({ uuid: uuid.optional(), name: z.string().trim().min(1).max(120), kind: z.enum(AGREEMENT_KINDS), language: z.enum(AGREEMENT_LANGUAGES), body: z.string().trim().min(20).max(30_000) })
  .strict();
export const agreementTemplateUpdateSchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), body: z.string().trim().min(20).max(30_000).optional(), archived: z.boolean().optional() })
  .strict();
export const agreementTemplateListQuery = z.object({ kind: z.enum(AGREEMENT_KINDS).optional(), language: z.enum(AGREEMENT_LANGUAGES).optional(), includeArchived: bool.optional() });
export const brochureQuery = z.object({
  format: z.enum(['pdf', 'png', 'text']).default('pdf'),
  lang: z.enum(['en', 'ur']).default('en'),
  hidePrice: bool.optional(),
  agentId: objectId.optional(),
});
export const financeReportQuery = z.object({ groupBy: z.enum(['month', 'category']).default('month'), from: z.coerce.date().optional(), to: z.coerce.date().optional() });

// ── Media & documents ──
export const mediaUpdateSchema = z.object({ sortOrder: z.number().int().min(0).optional(), setCover: z.boolean().optional() }).strict();
export const documentUploadFields = z.object({
  entityType: z.enum(DOCUMENT_ENTITY_TYPES),
  entityId: objectId,
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  fileName: optionalText(200),
  expiresAt: z.coerce.date().optional(),
});
export const documentListQuery = pagination.extend({
  entityType: z.enum(DOCUMENT_ENTITY_TYPES).optional(),
  entityId: objectId.optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
});
export const documentUpdateSchema = z.object({ fileName: shortText(200).min(1).optional(), category: z.enum(DOCUMENT_CATEGORIES).optional(), expiresAt: z.coerce.date().nullable().optional(), sharedWithPortal: z.boolean().optional() }).strict();

// ── Verification, saved views, property import ──
export const verificationSubmitSchema = z.object({ note: optionalText(500) }).strict();
export const verificationAssignSchema = z.object({ userId: objectId }).strict();
export const verificationChecklistSchema = z.object({ key: shortText(60).min(1), done: z.boolean(), note: optionalText(300) }).strict();
export const verificationDecideSchema = z
  .object({ decision: z.enum(VERIFICATION_DECISIONS), remarks: optionalText(1000), nextVerificationAt: z.coerce.date().nullable().optional() })
  .strict();
export const verificationQueueQuery = pagination.extend({ status: z.enum(VERIFICATION_STATUSES).optional(), mine: bool.optional() });
export const savedViewSchema = z
  .object({ page: z.enum(['clients', 'properties', 'deals', 'followups']), name: shortText(60).min(1), params: z.record(z.string().max(200)).refine((r) => Object.keys(r).length <= 30), shared: z.boolean().optional() })
  .strict();
export const savedViewQuery = z.object({ page: z.enum(['clients', 'properties', 'deals', 'followups']) });
// ── Rentals ──
export const leaseCreateSchema = z
  .object({
    uuid: uuid.optional(),
    branchId: branchRef,
    propertyId: objectId,
    landlordId: objectId.nullable().optional(),
    tenantId: objectId,
    agreementId: objectId.nullable().optional(),
    managerId: objectId.nullable().optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    monthlyRent: money.pipe(z.number().min(1)),
    dueDay: z.number().int().min(1).max(28).optional(),
    escalationPct: z.number().min(0).max(100).optional(),
    graceDays: z.number().int().min(0).max(60).optional(),
    lateFeeType: z.enum(LATE_FEE_TYPES).optional(),
    lateFeeValue: z.number().min(0).max(1e9).optional(),
    securityDeposit: money.optional(),
    managementFeePct: z.number().min(0).max(100).optional(),
    notes: optionalText(2000),
    markRented: z.boolean().optional(),
  })
  .strict();
export const leaseListQuery = pagination.extend({
  q: optionalText(100),
  status: z.enum(LEASE_STATUSES).optional(),
  propertyId: objectId.optional(),
  tenantId: objectId.optional(),
  landlordId: objectId.optional(),
  overdue: bool.optional(),
});
export const rentPaymentSchema = z
  .object({ id: uuid.optional(), date: z.coerce.date(), amount: money.pipe(z.number().min(1)), method: z.enum(PAYMENT_METHODS).optional(), reference: optionalText(100), notes: optionalText(500) })
  .strict();
export const rentWaiveSchema = z.object({ itemId: z.string().min(1).max(64), reason: shortText(300).min(2) }).strict();
export const inspectionSchema = z
  .object({ date: z.coerce.date(), type: z.enum(INSPECTION_TYPES), condition: z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'POOR']), notes: optionalText(2000) })
  .strict();
export const leaseRenewSchema = z.object({ endDate: z.coerce.date(), monthlyRent: money.pipe(z.number().min(1)).optional() }).strict();
export const leaseEndSchema = z
  .object({ status: z.enum(['ENDED', 'TERMINATED']), date: z.coerce.date().optional(), reason: optionalText(500), depositRefund: money.optional(), relist: z.boolean().optional() })
  .strict();

// ── Installments & finance reports ──
export const installmentPlanSchema = z
  .object({
    uuid: uuid.optional(),
    branchId: branchRef,
    dealId: objectId.nullable().optional(),
    clientId: objectId,
    propertyId: objectId.nullable().optional(),
    title: optionalText(150),
    totalAmount: money.pipe(z.number().min(1)),
    bookingAmount: money.optional(),
    downPayment: money.optional(),
    possessionAmount: money.optional(),
    frequency: z.enum(INSTALLMENT_FREQUENCIES),
    count: z.number().int().min(1).max(240).optional(),
    startDate: z.coerce.date(),
    graceDays: z.number().int().min(0).max(90).optional(),
    items: z.array(z.object({ kind: z.enum(['BOOKING', 'DOWN_PAYMENT', 'INSTALLMENT', 'BALLOON', 'POSSESSION']).optional(), label: shortText(80).min(1), dueDate: z.coerce.date(), amount: money.pipe(z.number().min(1)) }).strict()).max(240).optional(),
    notes: optionalText(2000),
  })
  .strict();
export const installmentListQuery = pagination.extend({ q: optionalText(100), status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional(), clientId: objectId.optional(), dealId: objectId.optional(), overdue: bool.optional() });
export const installmentCancelSchema = z.object({ reason: shortText(500).min(2) }).strict();
export const periodQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
export const agentStatementQuery = periodQuery.extend({ userId: objectId, format: z.enum(['json', 'pdf']).optional() });
export const receiptParams = z.object({ kind: z.enum(['lease', 'installment', 'deal']), id: objectId, paymentId: z.string().min(8).max(64) });

export const refundSchema = z.object({ amount: money.pipe(z.number().min(1)), date: z.coerce.date(), method: z.enum(PAYMENT_METHODS).optional(), reason: shortText(500).min(3), reference: optionalText(100) }).strict();
export const voucherParams = z.object({ kind: z.enum(['transaction', 'payout']), id: objectId, subId: z.string().max(64).optional() });
export const tenantNoticeSchema = z
  .object({
    type: z.enum(['RENT_REMINDER', 'RENT_INCREASE', 'RENEWAL', 'VACATE', 'MAINTENANCE', 'GENERAL']),
    subject: shortText(200).min(3),
    message: shortText(4000).min(5),
    deliveredVia: z.enum(['WHATSAPP', 'PRINTED', 'EMAIL', 'IN_PERSON']),
    date: z.coerce.date().optional(),
  })
  .strict();
export const performanceQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  branchId: objectId.optional(),
  agentId: objectId.optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  format: z.enum(['json', 'xlsx', 'pdf']).optional(),
});
export const noteBodySchema = z.object({ note: optionalText(500) }).strict();
export const dealAdjustmentSchema = z.object({ amount: z.coerce.number().int().min(-1e12).max(1e12).refine((v) => v !== 0, 'Enter a non-zero amount'), reason: shortText(500).min(3) }).strict();
export const dealDisputeSchema = z.object({ action: z.enum(['OPEN', 'RESOLVE']), text: shortText(1000).min(3) }).strict();

export const propertyImportFields = z.object({ ownerId: objectId.optional(), agentId: objectId.optional() });

// ── Notes & activities ──
export const noteListQuery = pagination.extend({ entityType: z.enum(ENTITY_TYPES), entityId: objectId });
export const noteCreateSchema = z.object({ uuid: uuid.optional(), entityType: z.enum(ENTITY_TYPES), entityId: ref, content: shortText(5000).min(1) }).strict();
export const noteUpdateSchema = z.object({ content: shortText(5000).min(1), baseVersion: z.number().int().positive().optional() }).strict();
export const activityListQuery = pagination.extend({ entityId: objectId.optional() });

// ── Matches & settings ──
export const matchListQuery = pagination.extend({
  clientId: objectId.optional(),
  propertyId: objectId.optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  band: z.enum(['EXCELLENT', 'VERY_GOOD', 'GOOD', 'POSSIBLE']).optional(),
  status: z.enum(MATCH_STATUSES).optional(),
  includeStale: bool.optional(),
});
export const matchUpdateSchema = z.object({ status: z.enum(MATCH_STATUSES) }).strict();
export const recalculateSchema = z.object({ clientId: objectId.optional(), propertyId: objectId.optional() }).strict();

const weight = z.number().int().min(0).max(100);
export const settingsUpdateSchema = z
  .object({
    matching: z
      .object({
        weights: z.object({ type: weight, location: weight, budget: weight, size: weight, purpose: weight, features: weight }).partial().strict().optional(),
        storeThreshold: z.number().int().min(0).max(100).optional(),
        notifyThreshold: z.number().int().min(0).max(100).optional(),
        crossBranch: z.boolean().optional(),
      })
      .strict()
      .optional(),
    sqftPerUnit: z.object({ MARLA: z.number().positive(), KANAL: z.number().positive(), ACRE: z.number().positive() }).partial().strict().optional(),
    retention: z.object({ auditLogMonths: z.number().int().min(0).max(240).optional(), activityMonths: z.number().int().min(0).max(240).optional() }).strict().optional(),
    dealPipeline: z
      .object({
        stages: z
          .array(z.object({ stage: z.enum(DEAL_STAGES), enabled: z.boolean().optional(), label: z.string().trim().max(40).optional(), labelUr: z.string().trim().max(40).optional(), probability: z.number().min(0).max(1).optional() }).strict())
          .max(DEAL_STAGES.length),
      })
      .strict()
      .optional(),
    leadAssignment: z
      .object({
        mode: z.enum(['NONE', 'ROUND_ROBIN', 'BY_SOURCE']).optional(),
        preferListingAgent: z.boolean().optional(),
        agentIds: z.array(objectId).max(50).optional(),
        bySource: z.array(z.object({ source: z.enum(CLIENT_SOURCES), userId: objectId }).strict()).max(20).optional(),
      })
      .strict()
      .optional(),
    leadScoring: z
      .object({
        weights: z.object(Object.fromEntries(LEAD_SCORE_FACTORS.map((f) => [f, z.number().min(0).max(100)]))).partial().strict().optional(),
        hotThreshold: z.number().int().min(1).max(100).optional(),
        warmThreshold: z.number().int().min(0).max(99).optional(),
      })
      .strict()
      .optional(),
    automation: z
      .object(Object.fromEntries(AUTOMATION_RULE_KEYS.map((k) => [k, z.object({ enabled: z.boolean().optional(), threshold: z.number().int().min(0).optional() }).strict()])))
      .partial()
      .strict()
      .optional(),
    reminders: z.object({ defaultMinutesBefore: z.number().int().min(0).max(10080) }).strict().optional(),
    commission: z
      .object({ defaultBuyerPct: z.number().min(0).max(20).optional(), defaultSellerPct: z.number().min(0).max(20).optional(), autoCreateIncome: z.boolean().optional(), closeApprovalRequired: z.boolean().optional(), payoutApprovalRequired: z.boolean().optional(), rules: z.array(z.object({ listingPurpose: z.enum(LISTING_PURPOSES).nullable().optional(), propertyType: z.enum(PROPERTY_TYPES).nullable().optional(), buyerPct: z.number().min(0).max(20), sellerPct: z.number().min(0).max(20) }).strict().refine((r) => !!(r.listingPurpose || r.propertyType), 'A rule needs a listing purpose or a property type')).max(20).optional() })
      .strict()
      .optional(),
  })
  .strict();

// ── Follow-ups ──
const followUpFields = {
  clientId: ref,
  propertyId: ref.nullable().optional(),
  type: z.enum(FOLLOWUP_TYPES),
  dueAt: z.coerce.date(),
  priority: z.enum(PRIORITIES).optional(),
  notes: optionalText(2000),
  assignedTo: objectId.optional(),
  reminderAt: z.coerce.date().nullable().optional(),
  reminderMinutesBefore: z.number().int().min(0).max(10080).optional(),
};
export const followUpCreateSchema = z.object({ uuid: uuid.optional(), ...followUpFields }).strict();
export const followUpUpdateSchema = z
  .object(followUpFields)
  .partial()
  .extend({ status: z.enum(FOLLOWUP_STATUSES).optional(), outcome: optionalText(1000), baseVersion: z.number().int().positive().optional() })
  .strict();
export const followUpCompleteSchema = z.object({ outcome: optionalText(1000), baseVersion: z.number().int().positive().optional() }).strict();
export const followUpListQuery = pagination.extend({
  assignedTo: z.union([objectId, z.literal('me')]).optional(),
  status: z.enum(FOLLOWUP_STATUSES).optional(),
  type: z.enum(FOLLOWUP_TYPES).optional(),
  clientId: objectId.optional(),
  propertyId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// ── Notifications & devices ──
export const notificationListQuery = pagination.extend({ category: z.enum(NOTIFICATION_CATEGORIES).optional(), unread: bool.optional() });
export const markAllReadSchema = z.object({ category: z.enum(NOTIFICATION_CATEGORIES).optional() }).strict();
export const deviceSchema = z.object({ token: z.string().min(20).max(4096), platform: z.enum(['android', 'ios', 'web']), localReminders: z.boolean().optional() }).strict();

// ── Dashboard, search, export, sync ──
export const analyticsQuery = z.object({ range: z.enum(['7d', '30d', '12m']).default('30d') });
export const myDayQuery = z.object({ scope: z.enum(['mine', 'all']).default('mine') });
export const searchQuery = z.object({
  q: shortText(100).min(1),
  types: list(z.enum(['clients', 'properties', 'owners', 'matches'])).default(['clients', 'properties', 'owners', 'matches']),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export const exportParams = z.object({ resource: z.enum(['clients', 'properties', 'owners', 'followups', 'matches', 'deals', 'commissions', 'transactions', 'finance', 'agreements']) });
export const exportQuery = z
  .object({ format: z.enum(['xlsx', 'pdf']).default('xlsx') })
  .passthrough();

const mutation = z
  .object({
    mutationId: uuid,
    entity: z.enum(['clients', 'owners', 'properties', 'followUps', 'notes', 'deals', 'transactions', 'agreements']),
    op: z.enum(['create', 'update', 'delete']),
    uuid,
    baseVersion: z.number().int().positive().optional(),
    data: z.record(z.unknown()).optional(),
    force: z.boolean().optional(),
  })
  .strict();
export const syncPushSchema = z.object({ mutations: z.array(mutation).min(1).max(100) }).strict();
export const syncPullQuery = z.object({ cursor: z.string().max(4000).optional(), limit: z.coerce.number().int().min(1).max(1000).default(500) });

export { nullableId };

// ── Bulk actions (lists) ──
const bulkIds = z.array(objectId).min(1).max(200);
export const bulkClientSchema = z.discriminatedUnion('action', [
  z.object({ ids: bulkIds, action: z.literal('ASSIGN'), assignedTo: objectId }).strict(),
  z.object({ ids: bulkIds, action: z.literal('STATUS'), status: z.enum(CLIENT_STATUSES) }).strict(),
  z.object({ ids: bulkIds, action: z.literal('DELETE') }).strict(),
]);
export const bulkPropertySchema = z.discriminatedUnion('action', [
  z.object({ ids: bulkIds, action: z.literal('ASSIGN'), agentIds: z.array(objectId).min(1).max(10) }).strict(),
  z.object({ ids: bulkIds, action: z.literal('STATUS'), status: z.enum(PROPERTY_STATUSES), reason: optionalText(300) }).strict(),
  z.object({ ids: bulkIds, action: z.literal('DELETE') }).strict(),
]);
