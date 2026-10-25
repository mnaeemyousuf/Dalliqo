import { ERROR_CODES, resolvePermissions } from '@recrm/shared';
import { memberRepository } from '../repositories/memberRepository';
import { sessionRepository } from '../repositories/sessionRepository';
import { userRepository } from '../repositories/userRepository';
import type { AuthContext } from '../types/context';
import { forbidden, unauthorized } from '../utils/AppError';
import type { AccessClaims } from './tokenService';

/**
 * Turns verified token claims into an AuthContext by checking live state:
 * the session is not revoked, the user is enabled and the membership is still
 * active. Permissions are read from the membership on every request, so
 * revoking a permission or a session takes effect immediately rather than
 * when the access token expires. Shared by HTTP middleware and Socket.IO.
 */
export async function resolveAuthContext(claims: AccessClaims): Promise<AuthContext> {
  const [session, member, user] = await Promise.all([
    sessionRepository.findActiveById(claims.sid, claims.sub),
    memberRepository.findActiveForAuth(claims.bid, claims.mid, claims.sub),
    userRepository.findById(claims.sub),
  ]);

  if (!session || session.memberId.toString() !== claims.mid) {
    throw unauthorized(ERROR_CODES.SESSION_REVOKED, 'Session has ended. Please sign in again.');
  }
  if (!user || user.status !== 'ACTIVE') {
    throw unauthorized(ERROR_CODES.ACCOUNT_DISABLED, 'Account is disabled');
  }
  if (!member) {
    throw forbidden(ERROR_CODES.NO_ACTIVE_MEMBERSHIP, 'You no longer have access to this business');
  }

  return {
    userId: claims.sub,
    businessId: claims.bid,
    memberId: claims.mid,
    sessionId: claims.sid,
    role: member.role,
    permissions: resolvePermissions(member.role, member.permissions),
    mustChangePassword: user.mustChangePassword,
  };
}
