import jwt, { type JwtPayload } from 'jsonwebtoken';
import { ERROR_CODES } from '@recrm/shared';
import { env } from '../config/env';
import { unauthorized } from '../utils/AppError';
import { hashToken, randomToken } from '../utils/crypto';
import { JWT_AUDIENCE as AUDIENCE, JWT_ISSUER as ISSUER } from '../constants';


export interface AccessClaims {
  sub: string; // userId
  bid: string; // businessId
  mid: string; // memberId
  sid: string; // sessionId
}

export const tokenService = {
  accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,

  signAccessToken(claims: AccessClaims): string {
    return jwt.sign({ bid: claims.bid, mid: claims.mid, sid: claims.sid }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: claims.sub,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    });
  },

  verifyAccessToken(token: string): AccessClaims {
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      }) as JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw unauthorized(ERROR_CODES.TOKEN_EXPIRED, 'Access token expired');
      }
      throw unauthorized(ERROR_CODES.INVALID_TOKEN, 'Invalid access token');
    }
    const { sub, bid, mid, sid } = payload as JwtPayload & Partial<AccessClaims>;
    if (!sub || !bid || !mid || !sid) throw unauthorized(ERROR_CODES.INVALID_TOKEN, 'Invalid access token');
    return { sub, bid, mid, sid };
  },

  /** Opaque refresh token; only its keyed hash is persisted. */
  generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
    const raw = randomToken(48);
    return {
      raw,
      hash: hashToken(raw),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    };
  },
};
