import { Schema, model, type Types } from 'mongoose';

export interface PasswordResetTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
  requestedIp?: string;
  createdAt: Date;
}

const schema = new Schema<PasswordResetTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    requestedIp: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ userId: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetToken = model<PasswordResetTokenDoc>('PasswordResetToken', schema, 'passwordResetTokens');
