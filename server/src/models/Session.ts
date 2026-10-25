import { Schema, model, type Types } from 'mongoose';

export const CLIENT_TYPES = ['web', 'mobile'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

/**
 * One document per signed-in device. The refresh token rotates on every use;
 * the previous hash is retained so a replayed (stolen) token can be detected
 * and the whole session revoked.
 */
export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  businessId: Types.ObjectId;
  memberId: Types.ObjectId;
  tokenHash: string;
  prevTokenHash?: string;
  clientType: ClientType;
  deviceName?: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  lastUsedAt: Date;
  rotatedAt?: Date;
  revokedAt?: Date | null;
  revokedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'BusinessMember', required: true },
    tokenHash: { type: String, required: true },
    prevTokenHash: { type: String },
    clientType: { type: String, enum: CLIENT_TYPES, required: true },
    deviceName: { type: String, maxlength: 100 },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 64 },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: () => new Date() },
    rotatedAt: { type: Date },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String },
  },
  { timestamps: true, versionKey: false },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ prevTokenHash: 1 }, { sparse: true });
sessionSchema.index({ userId: 1, revokedAt: 1 });
sessionSchema.index({ memberId: 1, revokedAt: 1 });
// MongoDB removes sessions automatically once they expire.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model<SessionDoc>('Session', sessionSchema, 'sessions');
