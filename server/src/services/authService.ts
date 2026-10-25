import { Types } from 'mongoose';
import { ERROR_CODES, ROLES, SOCKET_EVENTS, resolvePermissions, type Language, type ThemePreference } from '@recrm/shared';
import { env } from '../config/env';
import type { BusinessDoc } from '../models/Business';
import type { BusinessMemberDoc } from '../models/BusinessMember';
import type { ClientType, SessionDoc } from '../models/Session';
import { toPublicUser, type UserDoc } from '../models/User';
import { businessRepository } from '../repositories/businessRepository';
import { memberRepository } from '../repositories/memberRepository';
import { passwordResetRepository } from '../repositories/passwordResetRepository';
import { sessionRepository } from '../repositories/sessionRepository';
import { userRepository } from '../repositories/userRepository';
import type { AuthContext, RequestMeta } from '../types/context';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../utils/AppError';
import { hashToken, randomToken } from '../utils/crypto';
import { eventBus } from '../utils/eventBus';
import { isDuplicateKeyError } from '../utils/mongoErrors';
import { withTransaction } from '../utils/transaction';
import { auditService } from './auditService';
import { categoryService } from './categoryService';
import { settingsService } from './settingsService';
import { mailService } from './mailService';
import { passwordService } from './passwordService';
import { pushService } from './pushService';
import { tokenService } from './tokenService';

export interface SessionMeta extends RequestMeta {
  clientType: ClientType;
  deviceName?: string;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface AuthResult {
  user: ReturnType<typeof toPublicUser>;
  business: BusinessDoc;
  membership: { _id: Types.ObjectId; role: BusinessMemberDoc['role']; permissions: string[] };
  tokens: TokenPair;
}

function membershipView(member: BusinessMemberDoc) {
  return { _id: member._id, role: member.role, permissions: resolvePermissions(member.role, member.permissions) };
}

async function issueSession(user: UserDoc, member: BusinessMemberDoc, meta: SessionMeta): Promise<TokenPair> {
  const refresh = tokenService.generateRefreshToken();
  const session = await sessionRepository.create({
    userId: user._id,
    businessId: member.businessId,
    memberId: member._id,
    tokenHash: refresh.hash,
    clientType: meta.clientType,
    deviceName: meta.deviceName,
    userAgent: meta.userAgent?.slice(0, 300),
    ip: meta.ip,
    expiresAt: refresh.expiresAt,
  });
  return {
    accessToken: tokenService.signAccessToken({
      sub: user._id.toString(),
      bid: member.businessId.toString(),
      mid: member._id.toString(),
      sid: session._id.toString(),
    }),
    accessTokenExpiresIn: tokenService.accessTtlSeconds,
    refreshToken: refresh.raw,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

function notifySessionsRevoked(businessId: string, userId: string, actorUserId: string, sessionId?: string) {
  eventBus.publish({
    name: SOCKET_EVENTS.SESSION_REVOKED,
    businessId,
    actorUserId,
    entity: 'session',
    entityId: sessionId ?? userId,
    targetUserId: userId,
    data: sessionId ? { sessionId } : { allSessions: true },
  });
}

export const authService = {
  async register(
    input: { fullName: string; email: string; password: string; mobileNumber?: string; businessName: string },
    meta: SessionMeta,
  ): Promise<AuthResult> {
    const email = input.email.toLowerCase();
    if (await userRepository.findByEmail(email)) {
      throw conflict(ERROR_CODES.EMAIL_IN_USE, 'An account with this email already exists');
    }
    const passwordHash = await passwordService.hash(input.password);

    let created: { user: UserDoc; business: BusinessDoc; member: BusinessMemberDoc };
    try {
      created = await withTransaction(async (session) => {
        const userId = new Types.ObjectId();
        const businessId = new Types.ObjectId();
        const ctx = { businessId: businessId.toString(), userId: userId.toString() };

        const user = await userRepository.create(
          { _id: userId, email, passwordHash, fullName: input.fullName, mobileNumber: input.mobileNumber, defaultBusinessId: businessId },
          session,
        );
        const business = await businessRepository.create(
          { _id: businessId, name: input.businessName, ownerUserId: userId, createdBy: userId, updatedBy: userId },
          session,
        );
        const member = await memberRepository.create(ctx, { userId, role: ROLES.OWNER, permissions: [] }, session);
        await categoryService.seedDefaults(ctx, session);
        await settingsService.createDefaults(ctx, session);
        await auditService.record(
          ctx,
          { action: 'business.created', entityType: 'business', entityId: businessId, entityLabel: business.name, ip: meta.ip },
          session,
        );
        return { user, business, member };
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict(ERROR_CODES.EMAIL_IN_USE, 'An account with this email already exists');
      throw err;
    }

    await userRepository.recordSuccessfulLogin(created.user._id);
    const tokens = await issueSession(created.user, created.member, meta);
    return {
      user: toPublicUser(created.user),
      business: created.business,
      membership: membershipView(created.member),
      tokens,
    };
  },

  async login(input: { email: string; password: string }, meta: SessionMeta): Promise<AuthResult> {
    const user = await userRepository.findByEmailWithSecrets(input.email);
    if (!user) {
      await passwordService.burnTime(input.password);
      throw unauthorized(ERROR_CODES.INVALID_CREDENTIALS, 'Incorrect email or password');
    }
    if (user.lockUntil && user.lockUntil > new Date()) {
      throw new AppError(423, ERROR_CODES.ACCOUNT_LOCKED, 'Too many failed attempts. Try again later.');
    }
    if (!(await passwordService.verify(user.passwordHash, input.password))) {
      await userRepository.recordFailedLogin(user._id, env.MAX_FAILED_LOGINS, env.LOCKOUT_MINUTES);
      throw unauthorized(ERROR_CODES.INVALID_CREDENTIALS, 'Incorrect email or password');
    }
    if (user.status !== 'ACTIVE') throw forbidden(ERROR_CODES.ACCOUNT_DISABLED, 'Account is disabled');

    const memberships = await memberRepository.findActiveMembershipsForUser(user._id);
    const member =
      memberships.find((m) => user.defaultBusinessId && m.businessId.equals(user.defaultBusinessId)) ?? memberships[0];
    if (!member) throw forbidden(ERROR_CODES.NO_ACTIVE_MEMBERSHIP, 'You are not an active member of any business');

    const business = await businessRepository.findCurrent({ businessId: member.businessId.toString(), userId: user._id.toString() });
    if (!business) throw notFound(ERROR_CODES.BUSINESS_NOT_FOUND, 'Business not found');

    await userRepository.recordSuccessfulLogin(user._id);
    const tokens = await issueSession(user, member, meta);
    await auditService.record(
      { businessId: member.businessId.toString(), userId: user._id.toString() },
      { action: 'auth.login', entityType: 'user', entityId: user._id, meta: { clientType: meta.clientType }, ip: meta.ip },
    );
    return { user: toPublicUser(user), business, membership: membershipView(member), tokens };
  },

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<TokenPair> {
    if (!rawToken) throw unauthorized(ERROR_CODES.INVALID_REFRESH_TOKEN, 'Refresh token missing');
    const hash = hashToken(rawToken);
    const session = await sessionRepository.findByTokenHash(hash);

    if (!session) {
      // A previously-rotated token being presented again means it was copied.
      const replayed = await sessionRepository.findByPrevTokenHash(hash);
      if (replayed && !replayed.revokedAt) {
        await sessionRepository.revoke(replayed._id, 'refresh_token_reuse');
        await auditService.record(
          { businessId: replayed.businessId.toString(), userId: replayed.userId.toString() },
          { action: 'auth.refresh_token_reuse', entityType: 'session', entityId: replayed._id, ip: meta.ip },
        );
        notifySessionsRevoked(replayed.businessId.toString(), replayed.userId.toString(), replayed.userId.toString(), replayed._id.toString());
        throw unauthorized(ERROR_CODES.REFRESH_TOKEN_REUSED, 'Session invalidated. Please sign in again.');
      }
      throw unauthorized(ERROR_CODES.INVALID_REFRESH_TOKEN, 'Invalid refresh token');
    }
    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw unauthorized(ERROR_CODES.INVALID_REFRESH_TOKEN, 'Session has ended. Please sign in again.');
    }

    await assertSessionPrincipalActive(session);

    const next = tokenService.generateRefreshToken();
    const rotated = await sessionRepository.rotate(session._id, hash, next.hash, next.expiresAt, meta.ip);
    if (!rotated) throw unauthorized(ERROR_CODES.INVALID_REFRESH_TOKEN, 'Invalid refresh token');

    return {
      accessToken: tokenService.signAccessToken({
        sub: session.userId.toString(),
        bid: session.businessId.toString(),
        mid: session.memberId.toString(),
        sid: session._id.toString(),
      }),
      accessTokenExpiresIn: tokenService.accessTtlSeconds,
      refreshToken: next.raw,
      refreshTokenExpiresAt: next.expiresAt,
    };
  },

  async logout(rawToken: string | undefined, sessionIdFromAccess?: string): Promise<void> {
    if (rawToken) {
      const session = await sessionRepository.findByTokenHash(hashToken(rawToken));
      if (session) {
        await sessionRepository.revoke(session._id, 'logout');
        await pushService.removeForSession(session._id.toString());
      }
      return;
    }
    if (sessionIdFromAccess) {
      await sessionRepository.revoke(sessionIdFromAccess, 'logout');
      await pushService.removeForSession(sessionIdFromAccess);
    }
  },

  async logoutAll(auth: AuthContext): Promise<void> {
    await sessionRepository.revokeAllForUser(auth.userId, 'logout_all');
    await auditService.record(auth, { action: 'auth.logout_all', entityType: 'user', entityId: new Types.ObjectId(auth.userId) });
    notifySessionsRevoked(auth.businessId, auth.userId, auth.userId);
  },

  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await userRepository.findByEmail(email);
    // Same response whether or not the account exists (no user enumeration).
    if (!user || user.status !== 'ACTIVE') return;

    const raw = randomToken(32);
    await passwordResetRepository.create({
      userId: user._id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000),
      requestedIp: meta.ip,
    });
    const link = `${env.APP_WEB_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(raw)}`;
    await mailService.send({
      to: user.email,
      subject: 'Reset your Dalliqo password',
      text:
        `Hello ${user.fullName},\n\nUse the link below to reset your Dalliqo password. ` +
        `It expires in ${env.PASSWORD_RESET_TTL_MINUTES} minutes and can be used once.\n\n${link}\n\n` +
        `Reset code (for the mobile app): ${raw}\n\nIf you did not request this, you can ignore this email.\n\n— Dalliqo · Every Property. Every Lead. One Platform.`,
    });
  },

  async resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const record = await passwordResetRepository.consume(hashToken(token));
    if (!record) throw badRequest(ERROR_CODES.INVALID_RESET_TOKEN, 'This reset link is invalid or has expired');

    const user = await userRepository.updateById(record.userId, {
      passwordHash: await passwordService.hash(newPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockUntil: null,
    });
    if (!user) throw badRequest(ERROR_CODES.INVALID_RESET_TOKEN, 'This reset link is invalid or has expired');

    await sessionRepository.revokeAllForUser(user._id, 'password_reset');
    if (user.defaultBusinessId) {
      const ctx = { businessId: user.defaultBusinessId.toString(), userId: user._id.toString() };
      await auditService.record(ctx, { action: 'auth.password_reset', entityType: 'user', entityId: user._id, ip: meta.ip });
      notifySessionsRevoked(ctx.businessId, ctx.userId, ctx.userId);
    }
  },

  async changePassword(auth: AuthContext, currentPassword: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const user = await userRepository.findByIdWithSecrets(auth.userId);
    if (!user || !(await passwordService.verify(user.passwordHash, currentPassword))) {
      throw badRequest(ERROR_CODES.INVALID_CREDENTIALS, 'Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw badRequest(ERROR_CODES.PASSWORD_REUSED, 'New password must be different from the current one');
    }
    await userRepository.updateById(auth.userId, {
      passwordHash: await passwordService.hash(newPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
    });
    // Keep this device signed in; sign out every other device.
    await sessionRepository.revokeAllForUser(auth.userId, 'password_changed', auth.sessionId);
    await auditService.record(auth, { action: 'auth.password_changed', entityType: 'user', entityId: user._id, ip: meta.ip });
  },

  async me(auth: AuthContext) {
    const [user, business] = await Promise.all([userRepository.findById(auth.userId), businessRepository.findCurrent(auth)]);
    if (!user) throw unauthorized();
    if (!business) throw notFound(ERROR_CODES.BUSINESS_NOT_FOUND, 'Business not found');
    return {
      user: toPublicUser(user),
      business,
      membership: { _id: auth.memberId, role: auth.role, permissions: auth.permissions },
    };
  },

  async updateProfile(
    auth: AuthContext,
    input: { fullName?: string; mobileNumber?: string; preferences?: { language?: Language; theme?: ThemePreference } },
  ) {
    const update: Record<string, unknown> = {};
    if (input.fullName !== undefined) update.fullName = input.fullName;
    if (input.mobileNumber !== undefined) update.mobileNumber = input.mobileNumber;
    if (input.preferences?.language) update['preferences.language'] = input.preferences.language;
    if (input.preferences?.theme) update['preferences.theme'] = input.preferences.theme;
    const user = await userRepository.updateById(auth.userId, update as Partial<UserDoc>);
    if (!user) throw unauthorized();
    return toPublicUser(user);
  },

  async listSessions(auth: AuthContext) {
    const sessions = await sessionRepository.listActiveForUser(auth.userId);
    return sessions.map((s: SessionDoc) => ({
      _id: s._id,
      clientType: s.clientType,
      deviceName: s.deviceName,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      current: s._id.toString() === auth.sessionId,
    }));
  },

  async revokeSession(auth: AuthContext, sessionId: string): Promise<void> {
    const session = await sessionRepository.findActiveById(sessionId, auth.userId);
    if (!session) throw notFound(ERROR_CODES.SESSION_NOT_FOUND, 'Session not found');
    await sessionRepository.revoke(session._id, 'revoked_by_user');
    notifySessionsRevoked(auth.businessId, auth.userId, auth.userId, sessionId);
  },
};

async function assertSessionPrincipalActive(session: SessionDoc): Promise<void> {
  const [member, user] = await Promise.all([
    memberRepository.findActiveForAuth(session.businessId.toString(), session.memberId.toString(), session.userId.toString()),
    userRepository.findById(session.userId),
  ]);
  if (!member || !user || user.status !== 'ACTIVE') {
    await sessionRepository.revoke(session._id, 'principal_inactive');
    throw unauthorized(ERROR_CODES.SESSION_REVOKED, 'Session has ended. Please sign in again.');
  }
}
