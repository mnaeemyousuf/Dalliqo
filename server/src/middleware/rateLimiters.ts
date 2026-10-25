import { createHash } from 'node:crypto';
import type { Request } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { ERROR_CODES } from '@recrm/shared';
import { env } from '../config/env';
import { REFRESH_COOKIE } from '../constants';

const handler: Options['handler'] = (_req, res, _next, options) => {
  res.status(options.statusCode).json({
    success: false,
    code: ERROR_CODES.RATE_LIMITED,
    message: 'Too many requests. Please slow down and try again shortly.',
  });
};

const base = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  handler,
  skip: () => !env.RATE_LIMIT_ENABLED,
};

// req.ip honours the TRUST_PROXY setting, so this is the real client IP behind a load balancer.
const ipKey = (req: Request) => req.ip ?? 'unknown';

/**
 * Broad ceiling for the whole API. A whole office usually shares one public IP, so
 * signed-in traffic is limited per access token (one person/device) and the per-IP
 * ceiling is set for a busy office, not a single user. Health checks are never limited
 * (load balancers and uptime monitors call them constantly).
 */
const bearerKey = (req: Request) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? `tok:${createHash('sha256').update(h.slice(7)).digest('hex').slice(0, 32)}` : `ip:${ipKey(req)}`;
};
const isHealthCheck = (req: Request) => req.path === '/health';
export const apiLimiter = [
  rateLimit({ ...base, windowMs: 15 * 60_000, limit: 3000, keyGenerator: bearerKey, skip: (req) => !env.RATE_LIMIT_ENABLED || isHealthCheck(req) }),
  rateLimit({ ...base, windowMs: 15 * 60_000, limit: 30_000, keyGenerator: ipKey, skip: (req) => !env.RATE_LIMIT_ENABLED || isHealthCheck(req) }),
];

/** Credential endpoints: keyed by IP + email so one attacker can't lock many accounts quickly. */
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 20,
  keyGenerator: (req) => `${ipKey(req)}:${String(req.body?.email ?? '').toLowerCase()}`,
});

export const registerLimiter = rateLimit({ ...base, windowMs: 60 * 60_000, limit: 10, keyGenerator: ipKey });

export const passwordResetLimiter = rateLimit({ ...base, windowMs: 60 * 60_000, limit: 5, keyGenerator: ipKey });

/**
 * Refresh runs on every page load and access-token renewal, so a whole office behind
 * one IP refreshes often. Limit per refresh token (unguessable, so this stops a stuck
 * client looping) and keep only a generous per-IP ceiling against floods.
 */
const refreshTokenKey = (req: Request) => {
  const raw = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '');
  return raw ? `rt:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}` : `ip:${ipKey(req)}`;
};
export const refreshLimiter = [
  rateLimit({ ...base, windowMs: 15 * 60_000, limit: 60, keyGenerator: refreshTokenKey }),
  rateLimit({ ...base, windowMs: 15 * 60_000, limit: 3000, keyGenerator: ipKey }),
];
