import type { Types } from 'mongoose';
import { PasswordResetToken, type PasswordResetTokenDoc } from '../models/PasswordResetToken';

export const passwordResetRepository = {
  async create(data: { userId: Types.ObjectId; tokenHash: string; expiresAt: Date; requestedIp?: string }) {
    // Only the most recent reset link is valid.
    await PasswordResetToken.deleteMany({ userId: data.userId, usedAt: null });
    return PasswordResetToken.create(data);
  },

  /** Marks the token used and returns it, atomically, so a link works exactly once. */
  consume(tokenHash: string) {
    return PasswordResetToken.findOneAndUpdate(
      { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true },
    ).lean<PasswordResetTokenDoc>();
  },
};
