/** Domain enumerations. The Flutter app mirrors these in lib/core/constants. */

export const PROPERTY_TYPES = [
  'RESIDENTIAL_PLOT',
  'HOUSE',
  'FLAT',
  'APARTMENT',
  'PORTION',
  'FARMHOUSE',
  'FILE',
  'SHOP',
  'OFFICE',
  'COMMERCIAL',
  'COMMERCIAL_PLOT',
  'BUILDING',
  'WAREHOUSE',
  'FACTORY',
  'INDUSTRIAL_PLOT',
  'AGRICULTURAL_LAND',
  'OTHER',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Broad category of each property type (filters, reports, public listings). */
export const PROPERTY_CATEGORIES = ['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'AGRICULTURAL'] as const;
export type PropertyCategory = (typeof PROPERTY_CATEGORIES)[number];
export const PROPERTY_CATEGORY_OF: Record<PropertyType, PropertyCategory> = {
  RESIDENTIAL_PLOT: 'RESIDENTIAL',
  HOUSE: 'RESIDENTIAL',
  FLAT: 'RESIDENTIAL',
  APARTMENT: 'RESIDENTIAL',
  PORTION: 'RESIDENTIAL',
  FARMHOUSE: 'RESIDENTIAL',
  FILE: 'RESIDENTIAL',
  SHOP: 'COMMERCIAL',
  OFFICE: 'COMMERCIAL',
  COMMERCIAL: 'COMMERCIAL',
  COMMERCIAL_PLOT: 'COMMERCIAL',
  BUILDING: 'COMMERCIAL',
  WAREHOUSE: 'INDUSTRIAL',
  FACTORY: 'INDUSTRIAL',
  INDUSTRIAL_PLOT: 'INDUSTRIAL',
  AGRICULTURAL_LAND: 'AGRICULTURAL',
  OTHER: 'RESIDENTIAL',
};
export const propertyTypesInCategory = (c: PropertyCategory): PropertyType[] => PROPERTY_TYPES.filter((t) => PROPERTY_CATEGORY_OF[t] === c);

/** Pakistan-specific listing attributes. */
export const POSSESSION_STATUSES = ['POSSESSION', 'NON_POSSESSION', 'BALLOTED', 'UNBALLOTED'] as const;
export type PossessionStatus = (typeof POSSESSION_STATUSES)[number];
export const DEVELOPMENT_STATUSES = ['DEVELOPED', 'UNDER_DEVELOPMENT', 'UNDEVELOPED'] as const;
export type DevelopmentStatus = (typeof DEVELOPMENT_STATUSES)[number];
export const CONSTRUCTION_STATUSES = ['EMPTY_PLOT', 'GREY_STRUCTURE', 'UNDER_CONSTRUCTION', 'READY', 'NEEDS_RENOVATION'] as const;
export type ConstructionStatus = (typeof CONSTRUCTION_STATUSES)[number];
export const FURNISHING_STATUSES = ['UNFURNISHED', 'SEMI_FURNISHED', 'FURNISHED'] as const;
export type FurnishingStatus = (typeof FURNISHING_STATUSES)[number];
export const FACING_DIRECTIONS = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTH_EAST', 'NORTH_WEST', 'SOUTH_EAST', 'SOUTH_WEST'] as const;
export type FacingDirection = (typeof FACING_DIRECTIONS)[number];

export const PROPERTY_STATUSES = ['AVAILABLE', 'RESERVED', 'UNDER_NEGOTIATION', 'ON_HOLD', 'SOLD', 'RENTED', 'EXPIRED', 'WITHDRAWN', 'INACTIVE'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

/** What the property is listed for. Matching treats a purpose mismatch as disqualifying. */
export const LISTING_PURPOSES = ['SALE', 'RENT'] as const;
export type ListingPurpose = (typeof LISTING_PURPOSES)[number];

/** What the client wants to do. */
export const CLIENT_PURPOSES = ['PURCHASE', 'RENTAL'] as const;
export type ClientPurpose = (typeof CLIENT_PURPOSES)[number];

export const SIZE_UNITS = ['SQ_FT', 'SQ_YARD', 'SQ_METER', 'MARLA', 'KANAL', 'ACRE'] as const;
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

/** Where a lead came from. SOCIAL_MEDIA and PORTAL are kept for records created before the specific channels existed. */
export const CLIENT_SOURCES = ['WALK_IN', 'PHONE', 'REFERRAL', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'ZAMEEN', 'OLX', 'WEBSITE', 'SOCIAL_MEDIA', 'PORTAL', 'OTHER'] as const;
export type ClientSource = (typeof CLIENT_SOURCES)[number];

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
  ACRE: 43560,
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
  'DEAL_CREATED',
  'DEAL_UPDATED',
  'DEAL_STAGE_CHANGED',
  'DEAL_DELETED',
  'COMMISSION_RECEIVED',
  'COMMISSION_PAYMENT_REMOVED',
  'COMMISSION_PAYOUT',
  'TRANSACTION_RECORDED',
  'TRANSACTION_UPDATED',
  'TRANSACTION_DELETED',
  'AGREEMENT_CREATED',
  'AGREEMENT_UPDATED',
  'AGREEMENT_RENDERED',
  'AGREEMENT_STATUS_CHANGED',
  'AGREEMENT_DELETED',
  'LEAD_ASSIGNED',
  'LEAD_STATUS_CHANGED',
  'DEAL_OFFER_RECORDED',
  'DEAL_CHECKLIST_UPDATED',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ENTITY_TYPES = ['client', 'property', 'owner', 'followUp', 'deal', 'transaction', 'agreement'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const DOCUMENT_ENTITY_TYPES = ['client', 'property', 'owner', 'deal', 'transaction', 'agreement'] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

export const COMMUNICATION_CHANNELS = ['CALL', 'WHATSAPP', 'SMS', 'EMAIL'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const NOTIFICATION_CATEGORIES = ['FOLLOWUP', 'MATCH', 'PROPERTY', 'SYSTEM', 'LEAD', 'DEAL', 'AUTOMATION'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const MEDIA_KINDS = ['image', 'video', 'pdf', 'other'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Property types a buyer of one type will usually also consider. */
export const RELATED_PROPERTY_TYPES: Partial<Record<PropertyType, PropertyType[]>> = {
  FLAT: ['APARTMENT'],
  APARTMENT: ['FLAT'],
  HOUSE: ['PORTION', 'FARMHOUSE'],
  PORTION: ['HOUSE', 'FLAT'],
  FARMHOUSE: ['HOUSE'],
  RESIDENTIAL_PLOT: ['FILE'],
  FILE: ['RESIDENTIAL_PLOT'],
  SHOP: ['COMMERCIAL', 'OFFICE'],
  OFFICE: ['COMMERCIAL', 'SHOP'],
  COMMERCIAL: ['SHOP', 'OFFICE', 'BUILDING'],
  COMMERCIAL_PLOT: ['COMMERCIAL'],
  BUILDING: ['COMMERCIAL'],
  WAREHOUSE: ['FACTORY'],
  FACTORY: ['WAREHOUSE'],
};

export interface MatchingSettings {
  weights: { type: number; location: number; budget: number; size: number; purpose: number };
  storeThreshold: number;
  notifyThreshold: number;
  /** Multi-branch: also match clients with properties of other branches. */
  crossBranch: boolean;
}

export const DEFAULT_MATCHING_SETTINGS: MatchingSettings = {
  weights: { type: 25, location: 25, budget: 25, size: 15, purpose: 10 },
  storeThreshold: 60,
  notifyThreshold: 80,
  crossBranch: false,
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
  AVAILABLE: ['RESERVED', 'UNDER_NEGOTIATION', 'ON_HOLD', 'SOLD', 'RENTED', 'EXPIRED', 'WITHDRAWN', 'INACTIVE'],
  RESERVED: ['AVAILABLE', 'UNDER_NEGOTIATION', 'ON_HOLD', 'SOLD', 'RENTED', 'WITHDRAWN', 'INACTIVE'],
  UNDER_NEGOTIATION: ['AVAILABLE', 'RESERVED', 'ON_HOLD', 'SOLD', 'RENTED', 'WITHDRAWN', 'INACTIVE'],
  ON_HOLD: ['AVAILABLE', 'RESERVED', 'UNDER_NEGOTIATION', 'WITHDRAWN', 'INACTIVE'],
  SOLD: ['AVAILABLE', 'INACTIVE'],
  RENTED: ['AVAILABLE', 'INACTIVE'],
  EXPIRED: ['AVAILABLE', 'WITHDRAWN', 'INACTIVE'],
  WITHDRAWN: ['AVAILABLE', 'INACTIVE'],
  INACTIVE: ['AVAILABLE'],
};

/** Statuses in which a listing is still on the market (matching, inventory reports). */
export const MARKETABLE_PROPERTY_STATUSES: readonly PropertyStatus[] = ['AVAILABLE', 'RESERVED', 'UNDER_NEGOTIATION'];

/** Which branches a member can see: every branch, or only the ones on the membership. */
export const BRANCH_ACCESS = ['ALL', 'SELECTED'] as const;
export type BranchAccess = (typeof BRANCH_ACCESS)[number];

/** Header the web and mobile apps send with the branch picked in the branch switcher. */
export const BRANCH_HEADER = 'X-Branch-Id';

export const SYNC_ENTITIES = ['clients', 'owners', 'properties', 'followUps', 'notes', 'clientCategories', 'matches', 'branches', 'deals', 'transactions', 'transactionCategories', 'agreements', 'agreementTemplates'] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];
