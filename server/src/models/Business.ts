import { Schema, model, type Types } from 'mongoose';
import { BILLING_CYCLES, PLAN_KEYS, SUBSCRIPTION_STATUSES, SIZE_UNITS, type BillingCycle, type PlanKey, type SizeUnit, type SubscriptionStatus } from '@recrm/shared';

export const BUSINESS_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;

export const BILLING_EVENT_TYPES = ['TRIAL_STARTED', 'UPGRADE_REQUESTED', 'PLAN_CHANGED', 'PAYMENT_RECORDED', 'CANCELLED'] as const;

export interface BillingEvent {
  _id: Types.ObjectId;
  type: (typeof BILLING_EVENT_TYPES)[number];
  plan: PlanKey;
  cycle?: BillingCycle | null;
  amount?: number | null;
  reference?: string | null;
  note?: string | null;
  periodEnd?: Date | null;
  by?: Types.ObjectId | null;
  at: Date;
}

/** Public agency website (listings + inquiry form) at /w/<slug>. */
export interface WebsiteSettings {
  enabled: boolean;
  slug?: string | null;
  tagline?: string | null;
  about?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  /** Show the listing agents (name + WhatsApp) on listing pages. */
  showAgents: boolean;
}

/** WhatsApp Business Cloud API: the business's phone number registered under the platform's Meta app. */
export interface WhatsAppSettings {
  phoneNumberId?: string | null;
  displayNumber?: string | null;
  /** WhatsApp Business Account id — needed to read the approved message templates. */
  businessAccountId?: string | null;
  /** Approved templates, synced from Meta (needed to message someone outside the 24-hour window). */
  templates?: WhatsAppTemplate[];
  templatesSyncedAt?: Date | null;
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  body: string;
  /** Number of {{n}} placeholders in the body. */
  params: number;
}

/** What clients and owners can see / do in their portal (agency-controlled). */
export interface PortalSettings {
  showMatches: boolean;
  allowPreferenceUpdates: boolean;
  allowVisitRequests: boolean;
  showDocuments: boolean;
  showOwnerInquiries: boolean;
  showOwnerOffers: boolean;
  allowOwnerAvailabilityUpdates: boolean;
}
export const DEFAULT_PORTAL_SETTINGS: PortalSettings = { showMatches: true, allowPreferenceUpdates: true, allowVisitRequests: true, showDocuments: true, showOwnerInquiries: true, showOwnerOffers: true, allowOwnerAvailabilityUpdates: true };

export interface SubscriptionDoc {
  plan: PlanKey;
  status: SubscriptionStatus;
  cycle?: BillingCycle | null;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  history: BillingEvent[];
}

/** The tenant. Its _id is the businessId stamped on every tenant document. */
export interface BusinessDoc {
  _id: Types.ObjectId;
  name: string;
  /** The agency's own address when sold as SaaS: <subdomain>.<TENANT_BASE_DOMAIN>. */
  subdomain?: string | null;
  ownerUserId: Types.ObjectId;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country: string;
  currency: string;
  timezone: string;
  defaultSizeUnit: SizeUnit;
  status: (typeof BUSINESS_STATUSES)[number];
  subscription?: SubscriptionDoc;
  website?: WebsiteSettings;
  portal?: Partial<PortalSettings>;
  whatsapp?: WhatsAppSettings;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const businessSchema = new Schema<BusinessDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    subdomain: { type: String, trim: true, lowercase: true, maxlength: 40, default: null },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true, maxlength: 500 },
    city: { type: String, trim: true, maxlength: 100 },
    country: { type: String, default: 'PK', maxlength: 2 },
    currency: { type: String, default: 'PKR', maxlength: 3 },
    timezone: { type: String, default: 'Asia/Karachi' },
    defaultSizeUnit: { type: String, enum: SIZE_UNITS, default: 'SQ_YARD' },
    status: { type: String, enum: BUSINESS_STATUSES, default: 'ACTIVE' },
    // Businesses created before plans existed have no subscription and are treated as ENTERPRISE/ACTIVE
    // (migration 004 writes that explicitly).
    subscription: {
      plan: { type: String, enum: PLAN_KEYS },
      status: { type: String, enum: SUBSCRIPTION_STATUSES },
      cycle: { type: String, enum: [...BILLING_CYCLES, null], default: null },
      trialEndsAt: { type: Date, default: null },
      currentPeriodEnd: { type: Date, default: null },
      history: {
        type: [
          {
            type: { type: String, enum: BILLING_EVENT_TYPES, required: true },
            plan: { type: String, enum: PLAN_KEYS, required: true },
            cycle: { type: String, enum: [...BILLING_CYCLES, null], default: null },
            amount: { type: Number, default: null },
            reference: { type: String, maxlength: 120, default: null },
            note: { type: String, maxlength: 500, default: null },
            periodEnd: { type: Date, default: null },
            by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            at: { type: Date, required: true },
          },
        ],
        default: [],
      },
    },
    website: {
      enabled: { type: Boolean, default: false },
      slug: { type: String, trim: true, lowercase: true, maxlength: 60, default: null },
      tagline: { type: String, trim: true, maxlength: 160, default: null },
      about: { type: String, trim: true, maxlength: 3000, default: null },
      phone: { type: String, trim: true, maxlength: 20, default: null },
      whatsapp: { type: String, trim: true, maxlength: 20, default: null },
      email: { type: String, trim: true, lowercase: true, maxlength: 200, default: null },
      showAgents: { type: Boolean, default: true },
    },
    portal: {
      showMatches: { type: Boolean, default: true },
      allowPreferenceUpdates: { type: Boolean, default: true },
      allowVisitRequests: { type: Boolean, default: true },
      showDocuments: { type: Boolean, default: true },
      showOwnerInquiries: { type: Boolean, default: true },
      showOwnerOffers: { type: Boolean, default: true },
      allowOwnerAvailabilityUpdates: { type: Boolean, default: true },
    },
    whatsapp: {
      phoneNumberId: { type: String, trim: true, maxlength: 40, default: null },
      displayNumber: { type: String, trim: true, maxlength: 20, default: null },
      businessAccountId: { type: String, trim: true, maxlength: 40, default: null },
      templates: { type: [{ _id: false, name: String, language: String, category: String, body: String, params: Number }], default: [] },
      templatesSyncedAt: { type: Date, default: null },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

businessSchema.index({ ownerUserId: 1 });
businessSchema.index({ subdomain: 1 }, { unique: true, partialFilterExpression: { subdomain: { $type: 'string' } } });
businessSchema.index({ 'website.slug': 1 }, { unique: true, partialFilterExpression: { 'website.slug': { $type: 'string' } } });
businessSchema.index({ 'whatsapp.phoneNumberId': 1 }, { partialFilterExpression: { 'whatsapp.phoneNumberId': { $type: 'string' } } });

export const Business = model<BusinessDoc>('Business', businessSchema);
