import { Schema, model, type Types } from 'mongoose';
import { branchField, branchIndexes, tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

export interface PropertyOwnerDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  fullName: string;
  mobileNumber: string;
  alternateNumber?: string;
  whatsappNumber?: string;
  email?: string;
  address?: string;
  notes?: string;
  propertyCount: number;
  searchText: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<PropertyOwnerDoc>(
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
    notes: { type: String, maxlength: 2000 },
    propertyCount: { type: Number, default: 0 },
    searchText: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
branchIndexes(schema);
schema.index({ businessId: 1, deletedAt: 1, fullName: 1 });
schema.index({ businessId: 1, mobileNumber: 1 });
schema.index({ businessId: 1, searchText: 1 });
schema.plugin(tenantGuardPlugin);

export const PropertyOwner = model<PropertyOwnerDoc>('PropertyOwner', schema, 'propertyOwners');
