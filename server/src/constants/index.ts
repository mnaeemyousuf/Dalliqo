/**
 * Server-only constants. Domain enums, permissions, error codes and socket
 * event names are shared with the web and mobile apps through @recrm/shared
 * and re-exported here so server code has one import point.
 */
export * from '@recrm/shared';

/** httpOnly cookie that carries the web client's refresh token (path /api/auth). */
export const REFRESH_COOKIE = 'recrm_rt';

/** JWT `iss` / `aud` claims for access tokens. */
export const JWT_ISSUER = 'recrm-api';
export const JWT_AUDIENCE = 'recrm-clients';

/** Upload allow-lists, matched against the type sniffed from the file's bytes. */
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];
export const DOCUMENT_MIMES = [
  'application/pdf',
  ...IMAGE_MIMES,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/** Upper bound for a single Excel/PDF export; larger exports must be filtered. */
export const MAX_EXPORT_ROWS = 10_000;
