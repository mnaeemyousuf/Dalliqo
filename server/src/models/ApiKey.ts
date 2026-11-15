import { Schema, model, type Types } from 'mongoose';
import { ALL_PERMISSIONS } from '@recrm/shared';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';

/** An API access key. Only the SHA-256 of the secret is stored; `prefix` identifies it in lists. */
export interface ApiKeyDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  name: string;
  prefix: string;
  hash: string;
  permissions: string[];
  /** The member the key acts for (its creator). */
  memberId: Types.ObjectId;
  userId: Types.ObjectId;
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ApiKeyDoc>(
  {
    ...tenantFields,
    name: { type: String, required: true, trim: true, maxlength: 60 },
    prefix: { type: String, required: true },
    hash: { type: String, required: true },
    permissions: { type: [{ type: String, enum: ALL_PERMISSIONS }], default: [] },
    memberId: { type: Schema.Types.ObjectId, ref: 'BusinessMember', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

schema.index({ hash: 1 }, { unique: true });
schema.index({ businessId: 1, createdAt: -1 });
schema.plugin(tenantGuardPlugin);

export const ApiKey = model<ApiKeyDoc>('ApiKey', schema, 'apiKeys');
