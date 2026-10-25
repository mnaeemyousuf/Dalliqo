import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const optional = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
    MONGO_AUTO_INDEX: bool.default('true'),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    /** Used as the HMAC key for hashing opaque refresh / reset tokens at rest. */
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
    MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
    LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    COOKIE_SECURE: bool.default('false'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    RATE_LIMIT_ENABLED: bool.default('true'),
    APP_WEB_URL: z.string().url().default('http://localhost:5173'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    SMTP_HOST: optional,
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: bool.optional(),
    SMTP_USER: optional,
    SMTP_PASS: optional,
    MAIL_FROM: z.string().default('Dalliqo <no-reply@localhost>'),

    // Later phases (media, push, maps). Optional so Phase 1 runs without them.
    CLOUDINARY_CLOUD_NAME: optional,
    CLOUDINARY_API_KEY: optional,
    CLOUDINARY_API_SECRET: optional,
    FIREBASE_PROJECT_ID: optional,
    FIREBASE_CLIENT_EMAIL: optional,
    FIREBASE_PRIVATE_KEY: optional,
    GOOGLE_MAPS_API_KEY: optional,

    /** cloudinary | local. Defaults to cloudinary when its credentials are set, else local disk. */
    STORAGE_DRIVER: z.enum(['cloudinary', 'local']).optional(),
    UPLOAD_DIR: z.string().default('uploads'),
    /** Public base URL of this API, used to build links to locally stored files. */
    PUBLIC_API_URL: z.string().url().optional(),
    MAX_IMAGE_MB: z.coerce.number().positive().default(15),
    MAX_VIDEO_MB: z.coerce.number().positive().default(100),
    MAX_DOCUMENT_MB: z.coerce.number().positive().default(25),
    JOBS_ENABLED: bool.default('true'),
  })
  .superRefine((v, ctx) => {
    if (v.JWT_SECRET === v.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_SECRET' });
    }
    if (v.NODE_ENV === 'production') {
      if (!v.SMTP_HOST) ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'required in production' });
      if (!v.COOKIE_SECURE) ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
      if (!v.RATE_LIMIT_ENABLED) ctx.addIssue({ code: 'custom', path: ['RATE_LIMIT_ENABLED'], message: 'cannot be disabled in production' });
    }
  });

export type Env = z.infer<typeof schema>;

function load(): Env {
  // `KEY=` in a .env file means "not set", not an empty value.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
