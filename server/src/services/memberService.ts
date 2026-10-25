import { Types } from 'mongoose';
import {
  ASSIGNABLE_ROLES,
  ERROR_CODES,
  ROLE_PRESETS,
  ROLES,
  SOCKET_EVENTS,
  resolvePermissions,
  type Permission,
  type Role,
} from '@recrm/shared';
import type { MemberStatus } from '../models/BusinessMember';
import { memberRepository, type MemberWithUser } from '../repositories/memberRepository';
import { sessionRepository } from '../repositories/sessionRepository';
import { userRepository } from '../repositories/userRepository';
import type { AuthContext, RequestMeta } from '../types/context';
import { conflict, forbidden, notFound } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { eventBus } from '../utils/eventBus';
import { isDuplicateKeyError } from '../utils/mongoErrors';
import { withTransaction } from '../utils/transaction';
import { auditService } from './auditService';
import { passwordService } from './passwordService';

function view(m: MemberWithUser) {
  return {
    _id: m._id,
    role: m.role,
    status: m.status,
    permissions: resolvePermissions(m.role, m.permissions),
    joinedAt: m.joinedAt,
    user: m.userId,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}
export type MemberView = ReturnType<typeof view>;

function publish(auth: AuthContext, name: typeof SOCKET_EVENTS.MEMBER_CREATED | typeof SOCKET_EVENTS.MEMBER_UPDATED, memberId: string) {
  eventBus.publish({ name, businessId: auth.businessId, actorUserId: auth.userId, entity: 'member', entityId: memberId });
}

async function loadEditable(auth: AuthContext, memberId: string) {
  const member = await memberRepository.findById(auth, memberId);
  if (!member || member.status === 'REMOVED') throw notFound(ERROR_CODES.MEMBER_NOT_FOUND, 'Member not found');
  if (member.role === ROLES.OWNER) throw forbidden(ERROR_CODES.CANNOT_MODIFY_OWNER, 'The business owner cannot be modified');
  if (member._id.toString() === auth.memberId) throw forbidden(ERROR_CODES.CANNOT_MODIFY_SELF, 'You cannot modify your own membership');
  return member;
}

export const memberService = {
  async list(auth: AuthContext, opts: { page: number; limit: number; status?: MemberStatus }) {
    const { items, total } = await memberRepository.list(auth, opts);
    return { items: items.map(view), total };
  },

  async get(auth: AuthContext, memberId: string): Promise<MemberView> {
    const member = await memberRepository.findByIdWithUser(auth, memberId);
    if (!member || member.status === 'REMOVED') throw notFound(ERROR_CODES.MEMBER_NOT_FOUND, 'Member not found');
    return view(member);
  },

  /**
   * Adds a person (e.g. the owner's son) to the business. The owner sets a
   * temporary password and the new user must change it at first sign-in.
   */
  async create(
    auth: AuthContext,
    input: { fullName: string; email: string; mobileNumber?: string; temporaryPassword: string; role?: Role; permissions?: Permission[] },
    meta: RequestMeta,
  ): Promise<MemberView> {
    const role = input.role ?? ROLES.MEMBER;
    if (!ASSIGNABLE_ROLES.includes(role)) throw forbidden(ERROR_CODES.ROLE_NOT_ASSIGNABLE, `Role ${role} cannot be assigned`);
    if (await userRepository.findByEmail(input.email)) {
      throw conflict(ERROR_CODES.EMAIL_IN_USE, 'An account with this email already exists');
    }
    const permissions = input.permissions ?? [...ROLE_PRESETS[role]];
    const passwordHash = await passwordService.hash(input.temporaryPassword);

    let memberId: Types.ObjectId;
    try {
      memberId = await withTransaction(async (session) => {
        const user = await userRepository.create(
          {
            email: input.email.toLowerCase(),
            passwordHash,
            fullName: input.fullName,
            mobileNumber: input.mobileNumber,
            defaultBusinessId: new Types.ObjectId(auth.businessId),
            mustChangePassword: true,
          },
          session,
        );
        const member = await memberRepository.create(auth, { userId: user._id, role, permissions }, session);
        await auditService.record(
          auth,
          {
            action: 'member.created',
            entityType: 'member',
            entityId: member._id,
            entityLabel: user.fullName,
            meta: { role, permissions },
            ip: meta.ip,
          },
          session,
        );
        return member._id;
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict(ERROR_CODES.EMAIL_IN_USE, 'An account with this email already exists');
      throw err;
    }

    publish(auth, SOCKET_EVENTS.MEMBER_CREATED, memberId.toString());
    return this.get(auth, memberId.toString());
  },

  async update(
    auth: AuthContext,
    memberId: string,
    input: { role?: Role; permissions?: Permission[]; status?: Exclude<MemberStatus, 'REMOVED'> },
    meta: RequestMeta,
  ): Promise<MemberView> {
    const before = await loadEditable(auth, memberId);
    const update: { role?: Role; permissions?: string[]; status?: MemberStatus } = {};

    if (input.role && input.role !== before.role) {
      if (!ASSIGNABLE_ROLES.includes(input.role)) {
        throw forbidden(ERROR_CODES.ROLE_NOT_ASSIGNABLE, `Role ${input.role} cannot be assigned`);
      }
      update.role = input.role;
      update.permissions = input.permissions ?? [...ROLE_PRESETS[input.role]];
    } else if (input.permissions) {
      update.permissions = Array.from(new Set(input.permissions));
    }
    if (input.status) update.status = input.status;

    const updated = await memberRepository.update(auth, memberId, update);
    if (!updated) throw notFound(ERROR_CODES.MEMBER_NOT_FOUND, 'Member not found');

    if (update.status === 'SUSPENDED' && before.status !== 'SUSPENDED') {
      await sessionRepository.revokeAllForMember(memberId, 'member_suspended');
      eventBus.publish({
        name: SOCKET_EVENTS.SESSION_REVOKED,
        businessId: auth.businessId,
        actorUserId: auth.userId,
        entity: 'session',
        entityId: before.userId.toString(),
        targetUserId: before.userId.toString(),
        data: { allSessions: true },
      });
    }

    const changes = diffFields(before as unknown as Record<string, unknown>, update, ['role', 'permissions', 'status']);
    if (changes.length) {
      await auditService.record(auth, { action: 'member.updated', entityType: 'member', entityId: updated._id, changes, ip: meta.ip });
      publish(auth, SOCKET_EVENTS.MEMBER_UPDATED, memberId);
    }
    return this.get(auth, memberId);
  },

  /** Soft-removes the membership and signs the person out everywhere. */
  async remove(auth: AuthContext, memberId: string, meta: RequestMeta): Promise<void> {
    const member = await loadEditable(auth, memberId);
    await memberRepository.update(auth, memberId, { status: 'REMOVED' });
    await sessionRepository.revokeAllForMember(memberId, 'member_removed');
    await auditService.record(auth, {
      action: 'member.removed',
      entityType: 'member',
      entityId: member._id,
      changes: [{ field: 'status', oldValue: member.status, newValue: 'REMOVED' }],
      ip: meta.ip,
    });
    publish(auth, SOCKET_EVENTS.MEMBER_UPDATED, memberId);
    eventBus.publish({
      name: SOCKET_EVENTS.SESSION_REVOKED,
      businessId: auth.businessId,
      actorUserId: auth.userId,
      entity: 'session',
      entityId: member.userId.toString(),
      targetUserId: member.userId.toString(),
      data: { allSessions: true },
    });
  },

  /** Owner sets a new temporary password for a member who forgot theirs. */
  async resetPassword(auth: AuthContext, memberId: string, temporaryPassword: string, meta: RequestMeta): Promise<void> {
    const member = await loadEditable(auth, memberId);
    await userRepository.updateById(member.userId, {
      passwordHash: await passwordService.hash(temporaryPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    });
    await sessionRepository.revokeAllForUser(member.userId, 'password_reset_by_owner');
    await auditService.record(auth, { action: 'member.password_reset', entityType: 'member', entityId: member._id, ip: meta.ip });
  },
};
