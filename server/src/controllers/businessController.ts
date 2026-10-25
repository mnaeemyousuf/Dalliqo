import type { Request, Response } from 'express';
import { authOf } from '../middleware/authenticate';
import { businessService } from '../services/businessService';
import { sendSuccess } from '../utils/http';
import { requestMeta } from './authController';

export const businessController = {
  async get(req: Request, res: Response) {
    sendSuccess(res, await businessService.getCurrent(authOf(req)));
  },

  async update(req: Request, res: Response) {
    const business = await businessService.updateCurrent(authOf(req), req.body, requestMeta(req));
    sendSuccess(res, business, { message: 'Business updated successfully' });
  },
};
