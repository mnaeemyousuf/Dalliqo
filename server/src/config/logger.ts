import pino from 'pino';
import { env } from './env';

// pino-pretty is a dev dependency; production images log plain JSON.
function prettyAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.currentPassword',
      '*.newPassword',
      '*.temporaryPassword',
      '*.refreshToken',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development' && prettyAvailable()
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
