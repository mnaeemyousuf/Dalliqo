/** Domain enumerations. The Flutter app mirrors these in lib/core/constants. */

export const PROPERTY_TYPES = [
  'RESIDENTIAL_PLOT',
  'HOUSE',
  'FLAT',
  'APARTMENT',
  'PORTION',
  'SHOP',
  'OFFICE',
  'COMMERCIAL',
  'OTHER',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD', 'RENTED', 'WITHDRAWN', 'INACTIVE'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

/** What the property is listed for. Matching treats a purpose mismatch as disqualifying. */
export const LISTING_PURPOSES = ['SALE', 'RENT'] as const;
export type ListingPurpose = (typeof LISTING_PURPOSES)[number];

/** What the client wants to do. */
export const CLIENT_PURPOSES = ['PURCHASE', 'RENTAL'] as const;
export type ClientPurpose = (typeof CLIENT_PURPOSES)[number];

export const SIZE_UNITS = ['SQ_FT', 'SQ_YARD', 'SQ_METER', 'MARLA', 'KANAL'] as const;
export type SizeUnit = (typeof SIZE_UNITS)[number];

/** Built-in client categories seeded for every new business; businesses may add custom ones. */
export const DEFAULT_CLIENT_CATEGORIES = [
  { key: 'PLOT_BUYER', name: 'Plot Buyer' },
  { key: 'HOUSE_BUYER', name: 'House Buyer' },
  { key: 'FLAT_BUYER', name: 'Flat/Apartment Buyer' },
  { key: 'PORTION_BUYER', name: 'Portion Buyer' },
  { key: 'RENTAL_CLIENT', name: 'Rental Client' },
  { key: 'COMMERCIAL_CLIENT', name: 'Commercial Property Client' },
  { key: 'PROPERTY_SELLER', name: 'Property Seller' },
  { key: 'PROPERTY_OWNER', name: 'Property Owner' },
  { key: 'INVESTOR', name: 'Investor' },
] as const;

export const CLIENT_STATUSES = ['ACTIVE', 'ON_HOLD', 'CLOSED_WON', 'CLOSED_LOST', 'INACTIVE'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CLIENT_SOURCES = ['WALK_IN', 'PHONE', 'REFERRAL', 'WHATSAPP', 'SOCIAL_MEDIA', 'PORTAL', 'OTHER'] as const;

export const FOLLOWUP_TYPES = ['CALL', 'MEETING', 'WHATSAPP', 'SMS', 'PROPERTY_VISIT', 'GENERAL'] as const;
export type FollowUpType = (typeof FOLLOWUP_TYPES)[number];

export const FOLLOWUP_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED', 'OVERDUE'] as const;
export type FollowUpStatus = (typeof FOLLOWUP_STATUSES)[number];

export const DOCUMENT_CATEGORIES = [
  'REGISTRATION',
  'OWNERSHIP',
  'AGREEMENT',
  'IDENTITY',
  'PROPERTY_DOCUMENT',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const MATCH_STATUSES = ['NEW', 'VIEWED', 'SHORTLISTED', 'CONTACTED', 'REJECTED', 'STALE'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const MATCH_BANDS = [
  { key: 'EXCELLENT', min: 90 },
  { key: 'VERY_GOOD', min: 80 },
  { key: 'GOOD', min: 70 },
  { key: 'POSSIBLE', min: 60 },
  { key: 'LOW', min: 0 },
] as const;
export type MatchBand = (typeof MATCH_BANDS)[number]['key'];

export function matchBand(score: number): MatchBand {
  return (MATCH_BANDS.find((b) => score >= b.min) ?? MATCH_BANDS[MATCH_BANDS.length - 1]).key;
}

export const SYNC_STATUSES = ['pending', 'syncing', 'synced', 'failed', 'conflict'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const LANGUAGES = ['en', 'ur'] as const;
export type Language = (typeof LANGUAGES)[number];

export const THEMES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEMES)[number];

/** Square feet per unit. MARLA varies by city; businesses can override it in settings. */
export const DEFAULT_SQFT_PER_UNIT: Record<SizeUnit, number> = {
  SQ_FT: 1,
  SQ_YARD: 9,
  SQ_METER: 10.7639,
  MARLA: 225,
  KANAL: 4500,
};

/**
 * An available listing whose availability hasn't been re-confirmed with the owner
 * for this many days is flagged "needs verification" (stale inventory is a top
 * complaint about property listings).
 */
export const LISTING_VERIFICATION_STALE_DAYS = 30;

export const ACTIVITY_TYPES = [
  'CLIENT_CREATED',
  'CLIENT_UPDATED',
  'CLIENT_DELETED',
  'CLIENT_CONTACTED',
  'OWNER_CREATED',
  'OWNER_UPDATED',
  'PROPERTY_CREATED',
  'PROPERTY_UPDATED',
  'PROPERTY_DELETED',
  'PRICE_CHANGED',
  'STATUS_CHANGED',
  'PROPERTY_VERIFIED',
  'FOLLOWUP_CREATED',
  'FOLLOWUP_COMPLETED',
  'FOLLOWUP_RESCHEDULED',
  'FOLLOWUP_CANCELLED',
  'MATCH_CREATED',
  'NOTE_ADDED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_DELETED',
  'MEDIA_UPLOADED',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ENTITY_TYPES = ['client', 'property', 'owner', 'followUp'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const DOCUMENT_ENTITY_TYPES = ['client', 'property', 'owner'] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

export const COMMUNICATION_CHANNELS = ['CALL', 'WHATSAPP', 'SMS', 'EMAIL'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const NOTIFICATION_CATEGORIES = ['FOLLOWUP', 'MATCH', 'PROPERTY', 'SYSTEM'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const MEDIA_KINDS = ['image', 'video', 'pdf', 'other'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Property types a buyer of one type will usually also consider. */
export const RELATED_PROPERTY_TYPES: Partial<Record<PropertyType, PropertyType[]>> = {
  FLAT: ['APARTMENT'],
  APARTMENT: ['FLAT'],
  HOUSE: ['PORTION'],
  PORTION: ['HOUSE', 'FLAT'],
  SHOP: ['COMMERCIAL', 'OFFICE'],
  OFFICE: ['COMMERCIAL', 'SHOP'],
  COMMERCIAL: ['SHOP', 'OFFICE'],
};

export interface MatchingSettings {
  weights: { type: number; location: number; budget: number; size: number; purpose: number };
  storeThreshold: number;
  notifyThreshold: number;
}

export const DEFAULT_MATCHING_SETTINGS: MatchingSettings = {
  weights: { type: 25, location: 25, budget: 25, size: 15, purpose: 10 },
  storeThreshold: 60,
  notifyThreshold: 80,
};

/** Codes the clients translate; params fill placeholders such as {society}. */
export const MATCH_REASON_CODES = [
  'TYPE_MATCH',
  'TYPE_ANY',
  'TYPE_RELATED',
  'SOCIETY_MATCH',
  'SOCIETY_MATCH_OTHER_BLOCK',
  'AREA_MATCH',
  'LOCATION_ANY',
  'BUDGET_WITHIN',
  'BUDGET_BELOW_MIN',
  'BUDGET_NEGOTIABLE',
  'BUDGET_SLIGHTLY_OVER',
  'BUDGET_ANY',
  'SIZE_WITHIN',
  'SIZE_CLOSE',
  'SIZE_ANY',
  'PURPOSE_MATCH',
] as const;
export type MatchReasonCode = (typeof MATCH_REASON_CODES)[number];

/** Allowed property status transitions (any status may move to INACTIVE or back to AVAILABLE). */
export const PROPERTY_STATUS_TRANSITIONS: Record<PropertyStatus, PropertyStatus[]> = {
  AVAILABLE: ['RESERVED', 'SOLD', 'RENTED', 'WITHDRAWN', 'INACTIVE'],
  RESERVED: ['AVAILABLE', 'SOLD', 'RENTED', 'WITHDRAWN', 'INACTIVE'],
  SOLD: ['AVAILABLE', 'INACTIVE'],
  RENTED: ['AVAILABLE', 'INACTIVE'],
  WITHDRAWN: ['AVAILABLE', 'INACTIVE'],
  INACTIVE: ['AVAILABLE'],
};

export const SYNC_ENTITIES = ['clients', 'owners', 'properties', 'followUps', 'notes', 'clientCategories', 'matches'] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];
