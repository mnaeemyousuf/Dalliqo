import { Schema, model, type Types } from 'mongoose';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';

export const SAVED_VIEW_PAGES = ['clients', 'properties', 'deals', 'followups'] as const;
export type SavedViewPage = (typeof SAVED_VIEW_PAGES)[number];

/** A named set of list filters. Private to its creator unless shared with the whole business. */
export interface SavedViewDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  userId: Types.ObjectId;
  page: SavedViewPage;
  name: string;
  params: Record<string, string>;
  shared: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<SavedViewDoc>(
  {
    ...tenantFields,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    page: { type: String, enum: SAVED_VIEW_PAGES, required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    params: { type: Schema.Types.Mixed, default: {} },
    shared: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

schema.index({ businessId: 1, page: 1, userId: 1 });
schema.index({ businessId: 1, page: 1, shared: 1 });
schema.plugin(tenantGuardPlugin);

export const SavedView = model<SavedViewDoc>('SavedView', schema, 'savedViews');
