import { Schema, model, type Types } from 'mongoose';
import {
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
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';
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
  notes?: string;
}

export interface ClientDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
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
    notes: { type: String, maxlength: 1000 },
  },
  { _id: true },
);

const schema = new Schema<ClientDoc>(
  {
    ...tenantFields,
    ...syncFields,
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
    searchText: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
schema.index({ businessId: 1, deletedAt: 1, updatedAt: -1 });
schema.index({ businessId: 1, mobileNumber: 1 });
schema.index({ businessId: 1, status: 1, updatedAt: -1 });
schema.index({ businessId: 1, categoryId: 1 });
schema.index({ businessId: 1, assignedTo: 1 });
schema.index({ businessId: 1, 'requirements.purpose': 1, 'requirements.active': 1 });
schema.index({ businessId: 1, searchText: 1 });
schema.plugin(tenantGuardPlugin);

export const Client = model<ClientDoc>('Client', schema, 'clients');
