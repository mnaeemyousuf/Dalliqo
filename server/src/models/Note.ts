import { Schema, model, type Types } from 'mongoose';
import { ENTITY_TYPES, type EntityType } from '@recrm/shared';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

export interface NoteDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  entityType: EntityType;
  entityId: Types.ObjectId;
  content: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<NoteDoc>(
  {
    ...tenantFields,
    ...syncFields,
    entityType: { type: String, enum: ENTITY_TYPES, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
schema.index({ businessId: 1, entityType: 1, entityId: 1, createdAt: -1 });
schema.plugin(tenantGuardPlugin);

export const Note = model<NoteDoc>('Note', schema, 'notes');
