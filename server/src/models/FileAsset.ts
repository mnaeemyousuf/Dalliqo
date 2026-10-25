import { Schema, model, type Types } from 'mongoose';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_ENTITY_TYPES,
  MEDIA_KINDS,
  type DocumentCategory,
  type DocumentEntityType,
  type MediaKind,
} from '@recrm/shared';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';

/**
 * Metadata for a file held in cloud storage. Binary content never goes into
 * MongoDB. `PropertyMedia` is the property gallery (images / videos, public
 * URLs); `Document` is any private file on a client, property or owner,
 * reachable only through short-lived signed URLs.
 */
export interface FileAssetDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  entityType: DocumentEntityType;
  entityId: Types.ObjectId;
  kind: MediaKind;
  category?: DocumentCategory;
  fileName: string;
  storageKey: string;
  storageProvider: 'cloudinary' | 'local';
  fileUrl?: string;
  thumbnailKey?: string;
  thumbnailUrl?: string;
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  sortOrder: number;
  isPrivate: boolean;
  uploadedBy: Types.ObjectId;
  deletedAt?: Date | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

function buildSchema() {
  const schema = new Schema<FileAssetDoc>(
    {
      ...tenantFields,
      entityType: { type: String, enum: DOCUMENT_ENTITY_TYPES, required: true },
      entityId: { type: Schema.Types.ObjectId, required: true },
      kind: { type: String, enum: MEDIA_KINDS, required: true },
      category: { type: String, enum: DOCUMENT_CATEGORIES },
      fileName: { type: String, required: true, maxlength: 200 },
      storageKey: { type: String, required: true },
      storageProvider: { type: String, enum: ['cloudinary', 'local'], required: true },
      fileUrl: String,
      thumbnailKey: String,
      thumbnailUrl: String,
      mimeType: { type: String, required: true },
      fileSize: { type: Number, required: true },
      width: Number,
      height: Number,
      sortOrder: { type: Number, default: 0 },
      isPrivate: { type: Boolean, default: false },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true, versionKey: false },
  );
  schema.index({ businessId: 1, entityType: 1, entityId: 1, deletedAt: 1, sortOrder: 1 });
  schema.index({ businessId: 1, createdAt: -1 });
  schema.plugin(tenantGuardPlugin);
  return schema;
}

export const PropertyMedia = model<FileAssetDoc>('PropertyMedia', buildSchema(), 'propertyMedia');
export const Document = model<FileAssetDoc>('Document', buildSchema(), 'propertyDocuments');
