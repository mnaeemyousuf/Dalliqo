import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env';
import { authOf, bearerToken } from '../middleware/authenticate';
import type { ClientType } from '../models/Session';
import { authService, type TokenPair } from '../services/authService';
import { tokenService } from '../services/tokenService';
import type { RequestMeta } from '../types/context';
import { sendSuccess } from '../utils/http';
import { REFRESH_COOKIE } from '../constants';


export { REFRESH_COOKIE };

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api/auth',
});

/**
 * Mobile apps identify themselves with `X-Client-Type: mobile` and receive the
 * refresh token in the body (stored in the OS keystore). Browsers get it only
 * as an httpOnly cookie scoped to /api/auth, so page scripts can never read it.
 */
export function clientTypeOf(req: Request): ClientType {
  return String(req.headers['x-client-type'] ?? '').toLowerCase() === 'mobile' ? 'mobile' : 'web';
}

export function requestMeta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

function tokenBody(tokens: TokenPair, clientType: ClientType, res: Response) {
  if (clientType === 'web') {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...cookieOptions(), expires: tokens.refreshTokenExpiresAt });
    return {
      accessToken: tokens.accessToken,
      accessTokenExpiresIn: tokens.accessTokenExpiresIn,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    };
  }
  return tokens;
}

export const authController = {
  async register(req: Request, res: Response) {
    const clientType = clientTypeOf(req);
    const { deviceName, ...input } = req.body;
    const result = await authService.register(input, { ...requestMeta(req), clientType, deviceName });
    sendSuccess(
      res,
      { user: result.user, business: result.business, membership: result.membership, ...tokenBody(result.tokens, clientType, res) },
      { status: 201, message: 'Account created successfully' },
    );
  },

  async login(req: Request, res: Response) {
    const clientType = clientTypeOf(req);
    const { email, password, deviceName } = req.body;
    const result = await authService.login({ email, password }, { ...requestMeta(req), clientType, deviceName });
    sendSuccess(res, {
      user: result.user,
      business: result.business,
      membership: result.membership,
      ...tokenBody(result.tokens, clientType, res),
    });
  },

  async refresh(req: Request, res: Response) {
    const clientType = clientTypeOf(req);
    const raw = clientType === 'mobile' ? req.body.refreshToken : req.cookies?.[REFRESH_COOKIE];
    try {
      const tokens = await authService.refresh(raw, requestMeta(req));
      sendSuccess(res, tokenBody(tokens, clientType, res));
    } catch (err) {
      if (clientType === 'web') res.clearCookie(REFRESH_COOKIE, cookieOptions());
      throw err;
    }
  },

  async logout(req: Request, res: Response) {
    const clientType = clientTypeOf(req);
    const raw = clientType === 'mobile' ? req.body.refreshToken : req.cookies?.[REFRESH_COOKIE];
    let sid: string | undefined;
    const bearer = bearerToken(req);
    if (!raw && bearer) {
      try {
        sid = tokenService.verifyAccessToken(bearer).sid;
      } catch {
        // An expired access token is fine; there is just nothing to revoke by it.
      }
    }
    await authService.logout(raw, sid);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    sendSuccess(res, null, { message: 'Signed out' });
  },

  async logoutAll(req: Request, res: Response) {
    await authService.logoutAll(authOf(req));
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    sendSuccess(res, null, { message: 'Signed out of all devices' });
  },

  async forgotPassword(req: Request, res: Response) {
    await authService.forgotPassword(req.body.email, requestMeta(req));
    sendSuccess(res, null, { message: 'If an account exists for that email, a reset link has been sent' });
  },

  async resetPassword(req: Request, res: Response) {
    await authService.resetPassword(req.body.token, req.body.newPassword, requestMeta(req));
    sendSuccess(res, null, { message: 'Password updated. Please sign in.' });
  },

  async changePassword(req: Request, res: Response) {
    await authService.changePassword(authOf(req), req.body.currentPassword, req.body.newPassword, requestMeta(req));
    sendSuccess(res, null, { message: 'Password changed. Other devices have been signed out.' });
  },

  async me(req: Request, res: Response) {
    sendSuccess(res, await authService.me(authOf(req)));
  },

  async updateProfile(req: Request, res: Response) {
    sendSuccess(res, await authService.updateProfile(authOf(req), req.body), { message: 'Profile updated' });
  },

  async listSessions(req: Request, res: Response) {
    sendSuccess(res, await authService.listSessions(authOf(req)));
  },

  async revokeSession(req: Request, res: Response) {
    await authService.revokeSession(authOf(req), req.params.id);
    sendSuccess(res, null, { message: 'Session revoked' });
  },
};
