import { Schema, model, type Types } from 'mongoose';
import {
  BUYING_TIMELINES,
  LEAD_TEMPERATURES,
  LOST_REASONS,
  type BuyingTimeline,
  type LeadScoreReason,
  type LeadTemperature,
  type LostReason,
  CLIENT_PURPOSES,
  CLIENT_SOURCES,
  CLIENT_STATUSES,
  PRIORITIES,
  PROPERTY_TYPES,
  SIZE_UNITS,
  type ClientPurpose,
  type ClientStatus,
  type Priority,
  type PropertyType,
  type SizeUnit,
} from '@recrm/shared';
import { branchField, branchIndexes, tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

/**
 * A client can want several things (a plot to buy and a flat to rent).
 * Requirements are embedded so a client and its wishes are created, edited
 * and synced offline as one unit. The primary requirement is denormalised
 * onto the client for list filters and cards.
 */
export interface RequirementDoc {
  _id: Types.ObjectId;
  isPrimary: boolean;
  active: boolean;
  purpose: ClientPurpose;
  propertyTypes: PropertyType[];
  areas: string[];
  societies: string[];
  blocks: string[];
  minSize?: number;
  maxSize?: number;
  sizeUnit?: SizeUnit;
  minSizeSqft?: number;
  maxSizeSqft?: number;
  minBudget?: number;
  maxBudget?: number;
  bedroomsMin?: number;
  bathroomsMin?: number;
  constructionStatuses?: string[];
  possessionStatuses?: string[];
  amenities?: string[];
  notes?: string;
}

export interface ClientDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  fullName: string;
  mobileNumber: string;
  alternateNumber?: string;
  whatsappNumber?: string;
  email?: string;
  address?: string;
  categoryId?: Types.ObjectId;
  status: ClientStatus;
  priority: Priority;
  source?: string;
  assignedTo?: Types.ObjectId;
  notes?: string;
  requirements: RequirementDoc[];
  // Denormalised from the primary requirement (spec fields).
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
  lastContactedAt?: Date;
  // ── Lead management ──
  /** Campaign / ad / listing the lead came from (free text, used for attribution). */
  campaign?: string;
  /** Campaign the lead came from (website inquiries carry the campaign code). */
  campaignId?: Types.ObjectId | null;
  buyingTimeline?: BuyingTimeline;
  /** HOT/WARM/COLD set by a person; when empty the score decides. */
  temperatureOverride?: LeadTemperature | null;
  /** Effective temperature (override, else from the score). */
  temperature: LeadTemperature;
  leadScore: number;
  leadScoreReasons: LeadScoreReason[];
  leadScoredAt?: Date;
  /** First call/WhatsApp/completed follow-up, and minutes from creation to it. */
  firstContactedAt?: Date;
  responseMinutes?: number;
  lostReason?: LostReason;
  lostNote?: string;
  convertedAt?: Date;
  statusHistory: { status: ClientStatus; at: Date; by?: Types.ObjectId; note?: string }[];
  assignmentHistory: { from?: Types.ObjectId | null; to?: Types.ObjectId | null; at: Date; by?: Types.ObjectId; note?: string }[];
  searchText: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const requirementSchema = new Schema<RequirementDoc>(
  {
    isPrimary: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    purpose: { type: String, enum: CLIENT_PURPOSES, required: true },
    propertyTypes: { type: [{ type: String, enum: PROPERTY_TYPES }], default: [] },
    areas: { type: [String], default: [] },
    societies: { type: [String], default: [] },
    blocks: { type: [String], default: [] },
    minSize: Number,
    maxSize: Number,
    sizeUnit: { type: String, enum: SIZE_UNITS },
    minSizeSqft: Number,
    maxSizeSqft: Number,
    minBudget: { type: Number, min: 0 },
    maxBudget: { type: Number, min: 0 },
    bedroomsMin: { type: Number, min: 0 },
    bathroomsMin: { type: Number, min: 0 },
    constructionStatuses: { type: [String], default: [] },
    possessionStatuses: { type: [String], default: [] },
    amenities: { type: [String], default: [] },
    notes: { type: String, maxlength: 1000 },
  },
  { _id: true },
);

const schema = new Schema<ClientDoc>(
  {
    ...tenantFields,
    ...syncFields,
    ...branchField,
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    mobileNumber: { type: String, required: true },
    alternateNumber: String,
    whatsappNumber: String,
    email: { type: String, lowercase: true, trim: true },
    address: { type: String, maxlength: 500 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ClientCategory' },
    status: { type: String, enum: CLIENT_STATUSES, default: 'ACTIVE' },
    priority: { type: String, enum: PRIORITIES, default: 'MEDIUM' },
    source: { type: String, enum: CLIENT_SOURCES },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, maxlength: 2000 },
    requirements: { type: [requirementSchema], default: [] },
    preferredArea: String,
    preferredSociety: String,
    preferredBlock: String,
    propertyTypeRequired: { type: [{ type: String, enum: PROPERTY_TYPES }], default: [] },
    minSize: Number,
    maxSize: Number,
    sizeUnit: { type: String, enum: SIZE_UNITS },
    minBudget: Number,
    maxBudget: Number,
    purchaseOrRental: { type: String, enum: CLIENT_PURPOSES },
    matchCount: { type: Number, default: 0 },
    lastContactedAt: Date,
    campaign: { type: String, trim: true, maxlength: 120 },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    buyingTimeline: { type: String, enum: BUYING_TIMELINES },
    temperatureOverride: { type: String, enum: [...LEAD_TEMPERATURES, null], default: null },
    temperature: { type: String, enum: LEAD_TEMPERATURES, default: 'WARM' },
    leadScore: { type: Number, default: 0, min: 0, max: 100 },
    leadScoreReasons: {
      type: [{ _id: false, factor: String, code: String, points: Number, max: Number, positive: Boolean }] as never,
      default: [],
    },
    leadScoredAt: Date,
    firstContactedAt: Date,
    responseMinutes: Number,
    lostReason: { type: String, enum: LOST_REASONS },
    lostNote: { type: String, maxlength: 500 },
    convertedAt: Date,
    statusHistory: {
      type: [{ _id: false, status: { type: String, enum: CLIENT_STATUSES }, at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' }, note: String }],
      default: [],
    },
    assignmentHistory: {
      type: [{ _id: false, from: { type: Schema.Types.ObjectId, ref: 'User' }, to: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' }, note: String }],
      default: [],
    },
    searchText: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
branchIndexes(schema);
schema.index({ businessId: 1, deletedAt: 1, updatedAt: -1 });
schema.index({ businessId: 1, mobileNumber: 1 });
schema.index({ businessId: 1, status: 1, updatedAt: -1 });
schema.index({ businessId: 1, categoryId: 1 });
schema.index({ businessId: 1, assignedTo: 1 });
schema.index({ businessId: 1, deletedAt: 1, temperature: 1, leadScore: -1 });
schema.index({ businessId: 1, source: 1, createdAt: -1 });
schema.index({ businessId: 1, 'requirements.purpose': 1, 'requirements.active': 1 });
schema.index({ businessId: 1, 'requirements.blocks': 1 });
schema.index({ businessId: 1, searchText: 1 });
schema.index({ businessId: 1, campaignId: 1 }, { partialFilterExpression: { campaignId: { $type: 'objectId' } } });
schema.plugin(tenantGuardPlugin);

export const Client = model<ClientDoc>('Client', schema, 'clients');
