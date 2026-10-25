import { Router } from 'express';
import { PERMISSIONS } from '@recrm/shared';
import { businessController } from '../controllers/businessController';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/http';
import { updateBusinessSchema } from '../validators/business.schemas';

const r = Router();

r.get('/', asyncHandler(businessController.get));
r.patch('/', requirePermission(PERMISSIONS.BUSINESS_MANAGE), validate({ body: updateBusinessSchema }), asyncHandler(businessController.update));

export default r;
