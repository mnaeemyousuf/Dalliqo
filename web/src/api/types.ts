import type {
  ClientPurpose,
  ClientStatus,
  DocumentCategory,
  FollowUpStatus,
  FollowUpType,
  ListingPurpose,
  MatchBand,
  MatchReasonCode,
  MatchStatus,
  NotificationCategory,
  Permission,
  Priority,
  PropertyStatus,
  PropertyType,
  Role,
  SizeUnit,
} from '@recrm/shared';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
  meta?: PageMeta & Record<string, unknown>;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paged<T> {
  items: T[];
  meta: PageMeta & Record<string, unknown>;
}

export interface UserLite {
  _id: string;
  fullName: string;
  email?: string;
}

export interface User {
  _id: string;
  email: string;
  fullName: string;
  mobileNumber?: string;
  status: string;
  mustChangePassword: boolean;
  preferences: { language: 'en' | 'ur'; theme: 'light' | 'dark' | 'system' };
  lastLoginAt?: string;
}

export interface Business {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  currency: string;
  timezone: string;
  defaultSizeUnit: SizeUnit;
}

export interface Membership {
  _id: string;
  role: Role;
  permissions: Permission[];
}

export interface Session {
  user: User;
  business: Business;
  membership: Membership;
}

export interface Member {
  _id: string;
  role: Role;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  permissions: Permission[];
  joinedAt: string;
  user: { _id: string; email: string; fullName: string; mobileNumber?: string; lastLoginAt?: string; mustChangePassword: boolean };
}

export interface Category {
  _id: string;
  key?: string | null;
  name: string;
  nameUr?: string;
  isSystem: boolean;
  sortOrder: number;
  clientCount?: number;
  archivedAt?: string | null;
}

export interface Requirement {
  _id?: string;
  isPrimary?: boolean;
  active?: boolean;
  purpose: ClientPurpose;
  propertyTypes: PropertyType[];
  areas: string[];
  societies: string[];
  blocks: string[];
  minSize?: number;
  maxSize?: number;
  sizeUnit?: SizeUnit;
  minBudget?: number;
  maxBudget?: number;
  bedroomsMin?: number;
  notes?: string;
}

interface Versioned {
  _id: string;
  uuid: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | UserLite;
}

export interface Client extends Versioned {
  fullName: string;
  mobileNumber: string;
  alternateNumber?: string;
  whatsappNumber?: string;
  email?: string;
  address?: string;
  categoryId?: string;
  status: ClientStatus;
  priority: Priority;
  source?: string;
  assignedTo?: string;
  notes?: string;
  requirements: Requirement[];
  preferredArea?: string;
  preferredSociety?: string;
  preferredBlock?: string;
  propertyTypeRequired: PropertyType[];
  minSize?: number;
  maxSize?: number;
  sizeUnit?: SizeUnit;
  minBudget?: number;
  maxBudget?: number;
  purchaseOrRental?: ClientPurpose;
  matchCount: number;
  lastContactedAt?: string;
}

export interface Owner extends Versioned {
  fullName: string;
  mobileNumber: string;
  alternateNumber?: string;
  whatsappNumber?: string;
  email?: string;
  address?: string;
  notes?: string;
  propertyCount: number;
  properties?: Property[];
}

export interface Property extends Versioned {
  propertyId: string;
  propertyType: PropertyType;
  listingPurpose: ListingPurpose;
  status: PropertyStatus;
  title?: string;
  area?: string;
  society?: string;
  block?: string;
  street?: string;
  plotNumber?: string;
  city?: string;
  size: number;
  sizeUnit: SizeUnit;
  sizeSqft: number;
  askingPrice: number;
  expectedFinalPrice?: number;
  minimumPrice?: number;
  negotiable: boolean;
  ownerId?: string | { _id: string; fullName: string; mobileNumber: string; whatsappNumber?: string };
  description?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  bedrooms?: number;
  bathrooms?: number;
  floors?: number;
  coverImageUrl?: string;
  coverThumbnailUrl?: string;
  lastVerifiedAt?: string;
  lastVerifiedBy?: string;
  matchCount: number;
}

export interface Match {
  _id: string;
  clientId: Pick<Client, '_id' | 'fullName' | 'mobileNumber' | 'whatsappNumber' | 'email' | 'status'>;
  propertyId: Pick<Property, '_id' | 'propertyId' | 'propertyType' | 'listingPurpose' | 'status' | 'society' | 'area' | 'block' | 'size' | 'sizeUnit' | 'askingPrice' | 'coverThumbnailUrl' | 'coverImageUrl'>;
  matchScore: number;
  band: MatchBand;
  breakdown: Record<'type' | 'location' | 'budget' | 'size' | 'purpose', number>;
  matchReasons: { code: MatchReasonCode; params?: Record<string, string | number> }[];
  status: MatchStatus;
  createdAt: string;
}

export interface FollowUp extends Versioned {
  clientId: string | { _id: string; fullName: string; mobileNumber: string; whatsappNumber?: string };
  propertyId?: string | { _id: string; propertyId: string; society?: string; area?: string; propertyType: PropertyType };
  type: FollowUpType;
  dueAt: string;
  priority: Priority;
  notes?: string;
  assignedTo: string | UserLite;
  status: FollowUpStatus;
  reminderAt?: string;
  completedAt?: string;
  outcome?: string;
}

export interface Note extends Versioned {
  entityType: string;
  entityId: string;
  content: string;
}

export interface Activity {
  _id: string;
  type: string;
  summary: string;
  refs: { entityType: string; entityId: string; label?: string }[];
  actorUserId: UserLite;
  createdAt: string;
}

export interface FileAsset {
  _id: string;
  entityType: string;
  entityId: string;
  kind: 'image' | 'video' | 'pdf' | 'other';
  category?: DocumentCategory;
  fileName: string;
  fileUrl?: string;
  thumbnailUrl?: string;
  mimeType: string;
  fileSize: number;
  sortOrder: number;
  uploadedBy: string | UserLite;
  createdAt: string;
}

export interface AppNotification {
  _id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  deepLink?: string;
  readAt?: string | null;
  createdAt: string;
}

export interface AuditEntry {
  _id: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  changes: { field: string; oldValue: unknown; newValue: unknown }[];
  actorUserId: UserLite;
  createdAt: string;
}

export interface DashboardSummary {
  properties: { total: number; available: number; reserved: number; sold: number; rented: number; withdrawn: number; inactive: number; needsVerification: number };
  clients: { total: number; buyers: number; rental: number; owners: number; byCategory: { categoryId: string | null; name: string; count: number }[] };
  followUps: { today: number; overdue: number };
  today: { newClients: number; newProperties: number; newMatches: number };
  generatedAt: string;
}

export interface Analytics {
  propertyDistribution: { type: PropertyType; count: number }[];
  propertyStatus: { status: PropertyStatus; count: number }[];
  clientCategories: { name: string; count: number }[];
  followUpPerformance: { period: string; completed: number; overdue: number; pending: number; cancelled: number }[];
  newRecords: { period: string; clients: number; properties: number; matches: number }[];
  matchQuality: { band: MatchBand; count: number }[];
  leadSources: { source: string; total: number; won: number; lost: number; active: number }[];
  teamPerformance: { userId: string; name: string; followUpsCompleted: number; followUpsOverdue: number; activeClients: number }[];
}

export interface MyDay {
  todaysFollowUps: FollowUp[];
  overdueFollowUps: FollowUp[];
  todaysMeetings: FollowUp[];
  propertyVisits: FollowUp[];
  newClients: Client[];
  newProperties: Property[];
  newMatches: Match[];
}

export interface Settings {
  matching: { weights: Record<'type' | 'location' | 'budget' | 'size' | 'purpose', number>; storeThreshold: number; notifyThreshold: number };
  sqftPerUnit: Record<SizeUnit, number>;
  reminders: { defaultMinutesBefore: number };
}

export interface DeviceSession {
  _id: string;
  clientType: 'web' | 'mobile';
  deviceName?: string;
  userAgent?: string;
  ip?: string;
  lastUsedAt: string;
  current: boolean;
}
