import { Schema, model, type Types } from 'mongoose';
import { PORTAL_KINDS, type PortalKind } from '@recrm/shared';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';

/**
 * A secret link that lets a client or property owner see their own records without an account.
 * Only the SHA-256 of the token is stored; the token itself is shown once when the link is created.
 */
export interface PortalLinkDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  kind: PortalKind;
  /** Client._id (CLIENT) or PropertyOwner._id (OWNER). */
  partyId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  lastUsedAt?: Date | null;
  useCount: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<PortalLinkDoc>(
  {
    ...tenantFields,
    kind: { type: String, enum: PORTAL_KINDS, required: true },
    partyId: { type: Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    useCount: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ businessId: 1, kind: 1, partyId: 1, createdAt: -1 });
schema.plugin(tenantGuardPlugin);

export const PortalLink = model<PortalLinkDoc>('PortalLink', schema, 'portalLinks');
