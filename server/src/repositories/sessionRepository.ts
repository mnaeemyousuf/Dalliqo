import type { Types } from 'mongoose';
import { Session, type SessionDoc } from '../models/Session';

type NewSession = Pick<
  SessionDoc,
  'userId' | 'businessId' | 'memberId' | 'tokenHash' | 'clientType' | 'expiresAt' | 'deviceName' | 'userAgent' | 'ip'
>;

const active = () => ({ revokedAt: null, expiresAt: { $gt: new Date() } });

export const sessionRepository = {
  async create(data: NewSession): Promise<SessionDoc> {
    const doc = await Session.create(data);
    return doc.toObject();
  },

  findByTokenHash(tokenHash: string) {
    return Session.findOne({ tokenHash }).lean<SessionDoc>();
  },

  findByPrevTokenHash(tokenHash: string) {
    return Session.findOne({ prevTokenHash: tokenHash }).lean<SessionDoc>();
  },

  findActiveById(id: string, userId: string) {
    return Session.findOne({ _id: id, userId, ...active() }).lean<SessionDoc>();
  },

  /**
   * Atomic compare-and-swap rotation: succeeds only if the presented hash is
   * still current, so two concurrent refreshes cannot both win.
   */
  rotate(id: Types.ObjectId, currentHash: string, nextHash: string, expiresAt: Date, ip?: string) {
    const now = new Date();
    return Session.findOneAndUpdate(
      { _id: id, tokenHash: currentHash, ...active() },
      { $set: { tokenHash: nextHash, prevTokenHash: currentHash, rotatedAt: now, lastUsedAt: now, expiresAt, ip } },
      { new: true },
    ).lean<SessionDoc>();
  },

  revoke(id: string | Types.ObjectId, reason: string) {
    return Session.updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  },

  revokeAllForUser(userId: string | Types.ObjectId, reason: string, exceptSessionId?: string) {
    const filter: Record<string, unknown> = { userId, revokedAt: null };
    if (exceptSessionId) filter._id = { $ne: exceptSessionId };
    return Session.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
  },

  revokeAllForMember(memberId: string | Types.ObjectId, reason: string) {
    return Session.updateMany({ memberId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  },

  listActiveForUser(userId: string) {
    return Session.find({ userId, ...active() })
      .select('clientType deviceName userAgent ip createdAt lastUsedAt expiresAt')
      .sort({ lastUsedAt: -1 })
      .lean<SessionDoc[]>();
  },
};
