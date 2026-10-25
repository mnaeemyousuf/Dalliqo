import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { corsOrigins, env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiters';
import apiRoutes from './routes';

// Built web app, served by this process when present (WEB_DIST overrides; default: the monorepo's web/dist).
const WEB_DIST_CANDIDATES = [process.env.WEB_DIST, join(__dirname, '../../web/dist'), join(__dirname, '../../../web/dist')].filter(Boolean) as string[];
const isApiPath = (path: string) => path.startsWith('/api/') || path === '/api' || path.startsWith('/socket.io/');

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );

  // The API serves JSON only, so a locked-down CSP is safe there. When the built web app is served from
  // this process (single-service hosting, e.g. Render), its pages get a CSP that allows the app itself.
  const apiHelmet = helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  const webDist = WEB_DIST_CANDIDATES.find((p) => existsSync(join(p, 'index.html')));
  if (webDist) {
    const webHelmet = helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'wss:', 'ws:'],
          frameSrc: ['https://maps.google.com', 'https://www.google.com'],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
    });
    app.use((req, res, next) => (isApiPath(req.path) ? apiHelmet(req, res, next) : webHelmet(req, res, next)));
  } else {
    app.use(apiHelmet);
  }
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', apiLimiter, apiRoutes);

  if (webDist) {
    // Hashed build assets are immutable; index.html is always revalidated so new deploys show up.
    app.use('/assets', express.static(join(webDist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    // Client-side routes (e.g. /clients/123) all load the single-page app.
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
