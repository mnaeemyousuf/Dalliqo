import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/** Cryptographically random, URL-safe opaque token. */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Opaque tokens (refresh, password reset) are stored only as a keyed hash, so
 * a database leak alone cannot be replayed against the API.
 */
export function hashToken(token: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
