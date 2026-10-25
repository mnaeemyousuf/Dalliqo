import { Schema, model, type Types } from 'mongoose';
import { LANGUAGES, THEMES, type Language, type ThemePreference } from '@recrm/shared';

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Users are global identities (not tenant-scoped). What a user may see is
 * decided by their BusinessMember record, never by the User document.
 */
export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  fullName: string;
  mobileNumber?: string;
  status: UserStatus;
  defaultBusinessId?: Types.ObjectId;
  mustChangePassword: boolean;
  passwordChangedAt?: Date;
  failedLoginAttempts: number;
  lockUntil?: Date | null;
  lastLoginAt?: Date;
  preferences: { language: Language; theme: ThemePreference };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    mobileNumber: { type: String, trim: true },
    status: { type: String, enum: USER_STATUSES, default: 'ACTIVE' },
    defaultBusinessId: { type: Schema.Types.ObjectId, ref: 'Business' },
    mustChangePassword: { type: Boolean, default: false },
    passwordChangedAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date },
    preferences: {
      language: { type: String, enum: LANGUAGES, default: 'en' },
      theme: { type: String, enum: THEMES, default: 'system' },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        return ret;
      },
    },
  },
);

userSchema.index({ email: 1 }, { unique: true });

export const User = model<UserDoc>('User', userSchema);

export type PublicUser = Pick<
  UserDoc,
  '_id' | 'email' | 'fullName' | 'mobileNumber' | 'status' | 'mustChangePassword' | 'preferences' | 'lastLoginAt'
>;

export function toPublicUser(u: UserDoc): PublicUser {
  return {
    _id: u._id,
    email: u.email,
    fullName: u.fullName,
    mobileNumber: u.mobileNumber,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    preferences: u.preferences,
    lastLoginAt: u.lastLoginAt,
  };
}
