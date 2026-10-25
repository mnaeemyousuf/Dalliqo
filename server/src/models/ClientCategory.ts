import { Schema, model, type Types } from 'mongoose';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

export interface ClientCategoryDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  /** Set for the built-in categories (PLOT_BUYER, …); null for custom ones. */
  key?: string | null;
  name: string;
  nameUr?: string;
  isSystem: boolean;
  sortOrder: number;
  archivedAt?: Date | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ClientCategoryDoc>(
  {
    ...tenantFields,
    ...syncFields,
    key: { type: String, default: null },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameUr: { type: String, trim: true, maxlength: 80 },
    isSystem: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 100 },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
schema.index({ businessId: 1, sortOrder: 1 });
schema.index({ businessId: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: 'string' } } });
schema.plugin(tenantGuardPlugin);

export const ClientCategory = model<ClientCategoryDoc>('ClientCategory', schema, 'clientCategories');
