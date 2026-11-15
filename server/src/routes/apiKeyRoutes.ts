import { Router } from 'express';
import { z } from 'zod';
import { API_KEY_PERMISSIONS } from '@recrm/shared';
import { authOf } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { apiKeyService } from '../services/apiKeyService';
import { asyncHandler as h, sendSuccess } from '../utils/http';
import { idParams } from '../validators/common';

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    permissions: z
      .array(z.enum(API_KEY_PERMISSIONS as unknown as [string, ...string[]]))
      .min(1)
      .max(API_KEY_PERMISSIONS.length),
    expiresAt: z.coerce.date().nullable().optional(),
  })
  .strict();

/** Mounted at /api-keys behind sign-in, the `api` plan module and settings:manage. */
export const apiKeyRoutes = Router();
apiKeyRoutes.get(
  '/',
  h(async (req, res) => sendSuccess(res, await apiKeyService.list(authOf(req)))),
);
apiKeyRoutes.post(
  '/',
  validate({ body: createSchema }),
  h(async (req, res) => sendSuccess(res, await apiKeyService.create(authOf(req), req.body, { ip: req.ip }), { status: 201, message: 'API key created' })),
);
apiKeyRoutes.delete(
  '/:id',
  validate({ params: idParams }),
  h(async (req, res) => sendSuccess(res, await apiKeyService.revoke(authOf(req), req.params.id, { ip: req.ip }), { message: 'API key revoked' })),
);
