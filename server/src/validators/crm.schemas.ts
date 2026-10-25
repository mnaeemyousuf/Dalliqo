import { z } from 'zod';
import {
  CLIENT_PURPOSES,
  CLIENT_SOURCES,
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
} from '@recrm/shared';
import { email, objectId, pagination, personName, phone } from './common';

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
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(9).optional(),
    areas: z.array(shortText(120)).max(10).optional(),
    societies: z.array(shortText(120)).max(10).optional(),
    blocks: z.array(shortText(60)).max(20).optional(),
    minSize: size.optional(),
    maxSize: size.optional(),
    sizeUnit: z.enum(SIZE_UNITS).optional(),
    minBudget: money.optional(),
    maxBudget: money.optional(),
    bedroomsMin: z.number().int().min(0).max(50).optional(),
    notes: optionalText(1000),
  })
  .strict();

const clientFields = {
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
};

export const clientCreateSchema = z.object({ uuid: uuid.optional(), allowDuplicate: z.boolean().optional(), ...clientFields }).strict();
export const duplicateClientQuery = z.object({ phone: z.union([phone, z.array(phone).max(3)]), excludeId: objectId.optional() });
export const clientUpdateSchema = z.object(clientFields).partial().extend({ baseVersion: z.number().int().positive().optional() }).strict();

export const clientListQuery = pagination.extend({
  q: optionalText(100),
  categoryId: objectId.optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedTo: objectId.optional(),
  area: optionalText(120),
  society: optionalText(120),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  purpose: z.enum(CLIENT_PURPOSES).optional(),
  minBudget: money.optional(),
  maxBudget: money.optional(),
  sort: z.enum(['-updatedAt', '-createdAt', 'fullName', '-matchCount', '-maxBudget']).optional(),
});

export const communicationSchema = z.object({ channel: z.enum(COMMUNICATION_CHANNELS), note: optionalText(300) }).strict();

// ── Owners ──
const ownerFields = {
  fullName: personName,
  mobileNumber: phone,
  alternateNumber: phone.optional(),
  whatsappNumber: phone.optional(),
  email: email.optional(),
  address: optionalText(500),
  notes: optionalText(2000),
};
export const ownerCreateSchema = z.object({ uuid: uuid.optional(), ...ownerFields }).strict();
export const ownerUpdateSchema = z.object(ownerFields).partial().extend({ baseVersion: z.number().int().positive().optional() }).strict();
export const ownerListQuery = pagination.extend({ q: optionalText(100), sort: z.enum(['-updatedAt', 'fullName', '-propertyCount']).optional() });

// ── Properties ──
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const propertyFields = {
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
  googleMapsUrl: z.string().url().max(500).optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  bathrooms: z.number().int().min(0).max(50).optional(),
  floors: z.number().int().min(0).max(200).optional(),
};
const coordsTogether = (v: { latitude?: number | null; longitude?: number | null }) =>
  (v.latitude === undefined) === (v.longitude === undefined) && (v.latitude === null) === (v.longitude === null);

export const propertyCreateSchema = z
  .object({ uuid: uuid.optional(), ...propertyFields })
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
    lat: lat.optional(),
    lng: lng.optional(),
    radiusKm: z.coerce.number().positive().max(100).optional(),
    sort: z.enum(['-updatedAt', '-createdAt', 'askingPrice', '-askingPrice', 'sizeSqft', '-sizeSqft', '-matchCount', 'propertyId']).optional(),
  })
  .transform(({ lat: la, lng: lo, radiusKm, ...rest }) => ({
    ...rest,
    ...(la !== undefined && lo !== undefined ? { near: { lat: la, lng: lo, radiusKm: radiusKm ?? 2 } } : {}),
  }));

// ── Media & documents ──
export const mediaUpdateSchema = z.object({ sortOrder: z.number().int().min(0).optional(), setCover: z.boolean().optional() }).strict();
export const documentUploadFields = z.object({
  entityType: z.enum(DOCUMENT_ENTITY_TYPES),
  entityId: objectId,
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  fileName: optionalText(200),
});
export const documentListQuery = pagination.extend({
  entityType: z.enum(DOCUMENT_ENTITY_TYPES).optional(),
  entityId: objectId.optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
});
export const documentUpdateSchema = z.object({ fileName: shortText(200).min(1).optional(), category: z.enum(DOCUMENT_CATEGORIES).optional() }).strict();

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
        weights: z.object({ type: weight, location: weight, budget: weight, size: weight, purpose: weight }).partial().strict().optional(),
        storeThreshold: z.number().int().min(0).max(100).optional(),
        notifyThreshold: z.number().int().min(0).max(100).optional(),
      })
      .strict()
      .optional(),
    sqftPerUnit: z.object({ MARLA: z.number().positive(), KANAL: z.number().positive() }).partial().strict().optional(),
    reminders: z.object({ defaultMinutesBefore: z.number().int().min(0).max(10080) }).strict().optional(),
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
export const deviceSchema = z.object({ token: z.string().min(20).max(4096), platform: z.enum(['android', 'ios', 'web']) }).strict();

// ── Dashboard, search, export, sync ──
export const analyticsQuery = z.object({ range: z.enum(['7d', '30d', '12m']).default('30d') });
export const myDayQuery = z.object({ scope: z.enum(['mine', 'all']).default('mine') });
export const searchQuery = z.object({
  q: shortText(100).min(1),
  types: list(z.enum(['clients', 'properties', 'owners', 'matches'])).default(['clients', 'properties', 'owners', 'matches']),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export const exportParams = z.object({ resource: z.enum(['clients', 'properties', 'owners', 'followups', 'matches']) });
export const exportQuery = z
  .object({ format: z.enum(['xlsx', 'pdf']).default('xlsx') })
  .passthrough();

const mutation = z
  .object({
    mutationId: uuid,
    entity: z.enum(['clients', 'owners', 'properties', 'followUps', 'notes']),
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
