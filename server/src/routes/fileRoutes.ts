import path from 'node:path';
import { Router } from 'express';
import { ERROR_CODES } from '@recrm/shared';
import { LocalStorage, SAFE_KEY, storage, verifyLocalSignature } from '../services/storage/storage';
import { AppError, notFound } from '../utils/AppError';
import { asyncHandler } from '../utils/http';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Serves files for the local storage driver. Public gallery files use
 * unguessable keys; private documents require an unexpired HMAC signature.
 * With Cloudinary these routes are unused (files are served by the CDN).
 */
const r = Router();

function local(): LocalStorage {
  const s = storage();
  if (!(s instanceof LocalStorage)) throw notFound();
  return s;
}

function send(res: import('express').Response, key: string, data: Buffer, download?: string) {
  res.setHeader('Content-Type', MIME[path.extname(key).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  // Helmet sets same-origin by default; images must load in the web app on another origin.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (download) res.setHeader('Content-Disposition', `inline; filename="${download.replace(/["\r\n]/g, '')}"`);
  res.send(data);
}

r.get(
  '/public/:biz/:folder/:name',
  asyncHandler(async (req, res) => {
    const key = `${req.params.biz}/${req.params.folder}/${req.params.name}`;
    if (!SAFE_KEY.test(key)) throw notFound();
    const data = await local().read(key, false).catch(() => {
      throw notFound();
    });
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    send(res, key, data);
  }),
);

r.get(
  '/private/:biz/:folder/:name',
  asyncHandler(async (req, res) => {
    const key = `${req.params.biz}/${req.params.folder}/${req.params.name}`;
    if (!SAFE_KEY.test(key)) throw notFound();
    const exp = Number(req.query.exp);
    if (!verifyLocalSignature(key, exp, String(req.query.sig ?? ''))) {
      throw new AppError(403, ERROR_CODES.INVALID_SIGNATURE, 'This link has expired or is invalid');
    }
    const data = await local().read(key, true).catch(() => {
      throw notFound();
    });
    res.setHeader('Cache-Control', 'private, no-store');
    send(res, key, data, typeof req.query.name === 'string' ? req.query.name : undefined);
  }),
);

export default r;
