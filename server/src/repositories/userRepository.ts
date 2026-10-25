import type { ClientSession, Types } from 'mongoose';
import { User, type UserDoc } from '../models/User';

type NewUser = Pick<UserDoc, 'email' | 'passwordHash' | 'fullName'> &
  Partial<Pick<UserDoc, '_id' | 'mobileNumber' | 'defaultBusinessId' | 'mustChangePassword'>>;

export const userRepository = {
  findById(id: string | Types.ObjectId) {
    return User.findById(id).lean<UserDoc>();
  },

  findByEmail(email: string) {
    return User.findOne({ email: email.toLowerCase() }).lean<UserDoc>();
  },

  /** Includes the hidden credential and lockout fields. Only used by auth flows. */
  findByEmailWithSecrets(email: string) {
    return User.findOne({ email: email.toLowerCase() })
      .select('+passwordHash +failedLoginAttempts +lockUntil')
      .lean<UserDoc>();
  },

  findByIdWithSecrets(id: string | Types.ObjectId) {
    return User.findById(id).select('+passwordHash +failedLoginAttempts +lockUntil').lean<UserDoc>();
  },

  async create(data: NewUser, session?: ClientSession): Promise<UserDoc> {
    const [doc] = await User.create([{ ...data, passwordChangedAt: new Date() }], { session });
    return doc.toObject();
  },

  updateById(id: string | Types.ObjectId, update: Partial<UserDoc>, session?: ClientSession) {
    return User.findByIdAndUpdate(id, { $set: update }, { new: true, session }).lean<UserDoc>();
  },

  async recordFailedLogin(id: Types.ObjectId, maxAttempts: number, lockMinutes: number): Promise<void> {
    const updated = await User.findByIdAndUpdate(id, { $inc: { failedLoginAttempts: 1 } }, { new: true })
      .select('+failedLoginAttempts')
      .lean<UserDoc>();
    if (updated && updated.failedLoginAttempts >= maxAttempts) {
      await User.updateOne(
        { _id: id },
        { $set: { lockUntil: new Date(Date.now() + lockMinutes * 60_000), failedLoginAttempts: 0 } },
      );
    }
  },

  recordSuccessfulLogin(id: Types.ObjectId) {
    return User.updateOne({ _id: id }, { $set: { failedLoginAttempts: 0, lockUntil: null, lastLoginAt: new Date() } });
  },
};
