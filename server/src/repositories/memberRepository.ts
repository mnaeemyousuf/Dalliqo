import type { ClientSession, Types } from 'mongoose';
import type { Role } from '@recrm/shared';
import { BusinessMember, type BusinessMemberDoc, type MemberStatus } from '../models/BusinessMember';
import type { UserDoc } from '../models/User';
import type { TenantContext } from '../types/context';

export type MemberWithUser = Omit<BusinessMemberDoc, 'userId'> & {
  userId: Pick<UserDoc, '_id' | 'email' | 'fullName' | 'mobileNumber' | 'status' | 'lastLoginAt' | 'mustChangePassword'>;
};

const USER_FIELDS = 'email fullName mobileNumber status lastLoginAt mustChangePassword';

export const memberRepository = {
  async create(
    ctx: TenantContext,
    data: { userId: Types.ObjectId; role: Role; permissions: string[] },
    session?: ClientSession,
  ): Promise<BusinessMemberDoc> {
    const [doc] = await BusinessMember.create(
      [{ ...data, businessId: ctx.businessId, createdBy: ctx.userId, updatedBy: ctx.userId, status: 'ACTIVE' }],
      { session },
    );
    return doc.toObject();
  },

  findById(ctx: TenantContext, memberId: string) {
    return BusinessMember.findOne({ _id: memberId, businessId: ctx.businessId }).lean<BusinessMemberDoc>();
  },

  findByIdWithUser(ctx: TenantContext, memberId: string) {
    return BusinessMember.findOne({ _id: memberId, businessId: ctx.businessId })
      .populate('userId', USER_FIELDS)
      .lean<MemberWithUser>();
  },

  async list(
    ctx: TenantContext,
    opts: { page: number; limit: number; status?: MemberStatus },
  ): Promise<{ items: MemberWithUser[]; total: number }> {
    const filter: Record<string, unknown> = { businessId: ctx.businessId };
    filter.status = opts.status ?? { $ne: 'REMOVED' };
    const [items, total] = await Promise.all([
      BusinessMember.find(filter)
        .sort({ createdAt: 1 })
        .skip((opts.page - 1) * opts.limit)
        .limit(opts.limit)
        .populate('userId', USER_FIELDS)
        .lean<MemberWithUser[]>(),
      BusinessMember.countDocuments(filter),
    ]);
    return { items, total };
  },

  update(ctx: TenantContext, memberId: string, update: Partial<Pick<BusinessMemberDoc, 'role' | 'permissions' | 'status'>>) {
    return BusinessMember.findOneAndUpdate(
      { _id: memberId, businessId: ctx.businessId },
      { $set: { ...update, updatedBy: ctx.userId } },
      { new: true, runValidators: true },
    ).lean<BusinessMemberDoc>();
  },

  /** True if the user is an active member of this business (assignment targets). */
  async isActiveMemberUser(ctx: TenantContext, userId: string): Promise<boolean> {
    return (await BusinessMember.countDocuments({ businessId: ctx.businessId, userId, status: 'ACTIVE' })) > 0;
  },

  /** userIds of all active members, used to fan out notifications. */
  async activeUserIds(ctx: TenantContext): Promise<string[]> {
    const rows = await BusinessMember.find({ businessId: ctx.businessId, status: 'ACTIVE' }).select('userId').lean();
    return rows.map((r) => r.userId.toString());
  },

  /** Used on every authenticated request; all three ids must agree. */
  findActiveForAuth(businessId: string, memberId: string, userId: string) {
    return BusinessMember.findOne({ _id: memberId, businessId, userId, status: 'ACTIVE' }).lean<BusinessMemberDoc>();
  },

  /**
   * Cross-tenant by design: resolves which businesses a user belongs to at
   * sign-in, before any tenant is selected. Explicitly bypasses the guard.
   */
  findActiveMembershipsForUser(userId: string | Types.ObjectId) {
    return BusinessMember.find({ userId, status: 'ACTIVE' })
      .setOptions({ skipTenantGuard: true })
      .sort({ createdAt: 1 })
      .lean<BusinessMemberDoc[]>();
  },
};
