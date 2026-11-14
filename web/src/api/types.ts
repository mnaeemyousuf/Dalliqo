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
  BranchAccess,
  CommissionMode,
  CommissionSummary,
  DealSide,
  DealStage,
  PaymentMethod,
  TransactionType,
  AgreementKind,
  AgreementLanguage,
  AgreementStatus,
  AutomationSettings,
  Entitlements,
  BuyingTimeline,
  ConstructionStatus,
  DevelopmentStatus,
  FacingDirection,
  FurnishingStatus,
  LeadScoreReason,
  LeadScoringSettings,
  LeadTemperature,
  LostReason,
  OfferParty,
  OfferStatus,
  PlanDefinition,
  PlanKey,
  PossessionStatus,
  VerificationStatus,
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
  branchAccess?: BranchAccess;
  branchIds?: string[];
}

export interface Branch {
  _id: string;
  uuid: string;
  name: string;
  nameUr?: string;
  code?: string;
  address?: string;
  phone?: string;
  isDefault: boolean;
  archivedAt?: string | null;
  memberCount?: number;
  version: number;
}

export interface Session {
  user: User;
  business: Business;
  membership: Membership;
  /** Present on /auth/me (plan, modules, limits); sign-in responses fetch it right after. */
  entitlements?: Entitlements;
  platformAdmin?: boolean;
}

export interface Member {
  _id: string;
  role: Role;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  permissions: Permission[];
  branchAccess: BranchAccess;
  branchIds: string[];
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
  branchId?: string;
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
  campaign?: string;
  buyingTimeline?: BuyingTimeline;
  temperatureOverride?: LeadTemperature | null;
  temperature?: LeadTemperature;
  leadScore?: number;
  leadScoreReasons?: LeadScoreReason[];
  leadScoredAt?: string;
  firstContactedAt?: string;
  responseMinutes?: number;
  lostReason?: LostReason;
  lostNote?: string;
  convertedAt?: string;
  statusHistory?: { status: ClientStatus; at: string; by?: string; note?: string }[];
  assignmentHistory?: { from?: string | null; to?: string | null; at: string; by?: string; note?: string }[];
}

export interface LeadReport {
  totals: { leads: number; converted: number; conversionRate: number; unassigned: number; neverContacted: number; avgResponseMinutes: number | null };
  bySource: { source: string; leads: number; converted: number; lost: number; conversionRate: number; avgScore: number }[];
  byTemperature: Record<LeadTemperature, number>;
  aging: { key: string; count: number }[];
  lostReasons: { reason: string; count: number }[];
}

export interface InventoryReport {
  onMarket: number;
  avgDaysOnMarket: number;
  aging: { key: string; count: number; value: number }[];
  byStatus: Record<string, { count: number; value: number }>;
  byType: Record<string, number>;
  byCategory: Record<string, number>;
  oldest: { _id: string; propertyId: string; days: number; askingPrice: number; society?: string; block?: string; propertyType: PropertyType; status: PropertyStatus }[];
}

export interface ImportResult {
  created: number;
  duplicates: { row: number; name: string; existing: string }[];
  errors: { row: number; message: string }[];
}

export interface SubscriptionInfo extends Entitlements {
  cycle: 'MONTHLY' | 'ANNUAL' | null;
  usage: { users: number; branches: number; storageMb: number };
  history: { _id: string; type: string; plan: PlanKey; cycle?: string | null; amount?: number | null; reference?: string | null; note?: string | null; periodEnd?: string | null; at: string }[];
  plans: Record<PlanKey, PlanDefinition>;
}

export interface PlatformBusiness extends Entitlements {
  _id: string;
  name: string;
  city?: string;
  createdAt: string;
  cycle: 'MONTHLY' | 'ANNUAL' | null;
}

export interface Owner extends Versioned {
  branchId?: string;
  fullName: string;
  mobileNumber: string;
  alternateNumber?: string;
  whatsappNumber?: string;
  email?: string;
  address?: string;
  notes?: string;
  cnic?: string;
  cnicMasked?: string;
  propertyCount: number;
  properties?: Property[];
}

export interface Property extends Versioned {
  branchId?: string;
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
  phase?: string;
  sector?: string;
  unitNumber?: string;
  possessionStatus?: PossessionStatus;
  developmentStatus?: DevelopmentStatus;
  constructionStatus?: ConstructionStatus;
  furnishing?: FurnishingStatus;
  facing?: FacingDirection;
  corner?: boolean;
  mainRoad?: boolean;
  parkFacing?: boolean;
  amenities?: string[];
  availabilityExpiresAt?: string | null;
  coOwnerIds?: string[];
  agentIds?: string[];
  priceHistory?: { price: number; at: string; by?: string; note?: string }[];
  verification?: { status: VerificationStatus; assignedTo?: string | null; submittedAt?: string | null; nextVerificationAt?: string | null };
}

export interface Verification {
  status: VerificationStatus;
  assignedTo?: string | null;
  submittedBy?: string | null;
  submittedAt?: string | null;
  checklist: { key: string; done: boolean; note?: string | null; doneBy?: string | null; doneAt?: string | null }[];
  decision?: string | null;
  remarks?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  nextVerificationAt?: string | null;
  history: { status: VerificationStatus; action: string; remarks?: string | null; by?: string | null; at: string }[];
  missingDocuments: string[];
  expiringDocuments: { fileName: string; category?: string; expiresAt: string }[];
}

export interface SavedView {
  _id: string;
  page: string;
  name: string;
  params: Record<string, string>;
  shared: boolean;
  userId: string;
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
  branchId?: string;
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

export interface Deal {
  _id: string;
  uuid: string;
  version: number;
  branchId?: string;
  dealNo: string;
  title?: string;
  clientId: string | { _id: string; fullName: string; mobileNumber?: string };
  propertyId?: string | { _id: string; propertyId: string; society?: string; block?: string } | null;
  agents: { userId: string | { _id: string; fullName: string }; sharePct: number }[];
  stage: DealStage;
  lostReason?: string;
  stageHistory: { stage: DealStage; at: string; by?: string | { _id: string; fullName: string }; note?: string }[];
  agreedPrice?: number;
  finalPrice?: number;
  initialAskingPrice?: number;
  tokenAmount?: number;
  offers?: { _id: string; party: OfferParty; amount: number; status: OfferStatus; note?: string; at: string; by?: string }[];
  checklist?: { key: string; label?: string; done: boolean; doneAt?: string | null; doneBy?: string | null }[];
  approval?: { status: 'PENDING' | 'APPROVED' | 'REJECTED'; action: 'CLOSE_WON'; requestedBy?: string; requestedAt?: string; decidedBy?: string | null; decidedAt?: string | null; note?: string | null } | null;
  expectedCloseDate?: string | null;
  closedAt?: string | null;
  notes?: string;
  commission: { buyer: { mode: CommissionMode; value: number }; seller: { mode: CommissionMode; value: number } };
  payments: { _id: string; side: DealSide; amount: number; date: string; method: PaymentMethod; reference?: string; notes?: string }[];
  payouts: { _id: string; userId: string; amount: number; date?: string | null; status: 'PENDING' | 'PAID'; notes?: string }[];
  expectedTotal: number;
  receivedTotal: number;
  outstanding: number;
  commissionStatus: 'PENDING' | 'PARTIALLY_RECEIVED' | 'RECEIVED';
  createdAt: string;
  updatedAt: string;
  summary?: CommissionSummary;
}

export interface TransactionCategory {
  _id: string;
  uuid: string;
  key?: string;
  name: string;
  nameUr?: string;
  type: TransactionType;
  isSystem: boolean;
  sortOrder: number;
  archivedAt?: string | null;
}

export interface Transaction {
  _id: string;
  uuid: string;
  version: number;
  branchId?: string;
  type: TransactionType;
  categoryId: string | Pick<TransactionCategory, '_id' | 'name' | 'nameUr' | 'type' | 'key'>;
  amount: number;
  date: string;
  method: PaymentMethod;
  dealId?: string | { _id: string; dealNo: string; title?: string } | null;
  propertyId?: string | { _id: string; propertyId: string } | null;
  clientId?: string | { _id: string; fullName: string } | null;
  description?: string;
  reference?: string;
  source: 'MANUAL' | 'COMMISSION';
  createdAt: string;
  updatedAt: string;
}

export interface AgreementTemplate {
  _id: string;
  uuid: string;
  key?: string;
  name: string;
  kind: AgreementKind;
  language: AgreementLanguage;
  body: string;
  builtIn: boolean;
  archivedAt?: string | null;
}

export interface Agreement {
  _id: string;
  uuid: string;
  version: number;
  branchId?: string;
  agreementNo: string;
  templateId?: string | null;
  kind: AgreementKind;
  language: AgreementLanguage;
  title?: string;
  status: AgreementStatus;
  dealId?: string | { _id: string; dealNo: string; title?: string } | null;
  clientId: string | { _id: string; fullName: string; mobileNumber?: string };
  ownerId?: string | { _id: string; fullName: string; mobileNumber?: string } | null;
  propertyId?: string | { _id: string; propertyId: string; society?: string; block?: string } | null;
  amount?: number | null;
  tokenAmount?: number | null;
  monthlyRent?: number | null;
  securityDeposit?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  clientCnic?: string;
  ownerCnic?: string;
  witness1?: string;
  witness2?: string;
  notes?: string;
  versions: { no: number; body: string; source: 'RENDER' | 'EDIT'; createdAt: string; createdBy?: string | { _id: string; fullName: string } }[];
  signedDocumentId?: string | null;
  signedAt?: string | null;
  renewalFollowUpIds: string[];
  statusHistory: { status: AgreementStatus; at: string; by?: string | { _id: string; fullName: string }; note?: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface FinanceReport {
  groupBy: 'month' | 'category';
  rows: { key: string; label: string; labelUr?: string; income: number; expense: number; net: number; count: number }[];
  totals: { income: number; expense: number; net: number };
}

export interface CommissionReport {
  groupBy: 'month' | 'agent';
  rows: { key: string; label: string; received: number; payments: number }[];
  totals: { expected: number; received: number; outstanding: number };
  outstanding: { _id: string; dealNo: string; title?: string; stage: DealStage; expectedTotal: number; receivedTotal: number; outstanding: number }[];
}

export interface DashboardSummary {
  properties: { total: number; available: number; reserved: number; sold: number; rented: number; withdrawn: number; inactive: number; needsVerification: number };
  clients: { total: number; buyers: number; rental: number; owners: number; byCategory: { categoryId: string | null; name: string; count: number }[] };
  followUps: { today: number; overdue: number };
  today: { newClients: number; newProperties: number; newMatches: number };
  deals?: { open: number; wonThisMonth: number; receivedThisMonth: number; outstanding: number };
  finance?: { incomeThisMonth: number; expenseThisMonth: number; netThisMonth: number };
  agreements?: { drafts: number; awaitingSignature: number; expiringSoon: number };
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
  matching: { weights: Record<'type' | 'location' | 'budget' | 'size' | 'purpose', number>; storeThreshold: number; notifyThreshold: number; crossBranch: boolean };
  commission: { defaultBuyerPct: number; defaultSellerPct: number; autoCreateIncome: boolean; closeApprovalRequired?: boolean };
  sqftPerUnit: Record<SizeUnit, number>;
  reminders: { defaultMinutesBefore: number };
  leadScoring: LeadScoringSettings;
  automation: AutomationSettings;
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
