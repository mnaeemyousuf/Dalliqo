import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS as P } from '@recrm/shared';
import { authOf } from '../middleware/authenticate';
import { requirePermission as can } from '../middleware/authorize';
import { aiLimiter } from '../middleware/rateLimiters';
import { validate } from '../middleware/validate';
import { aiService } from '../services/ai/aiService';
import { assistantService } from '../services/ai/assistantService';
import { asyncHandler as h, sendSuccess } from '../utils/http';
import { idParams } from '../validators/common';

const language = z.enum(['en', 'ur']).default('en');
const assistantSchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4000) }).strict())
      .min(1)
      .max(40)
      .refine((m) => m[0].role === 'user' && m[m.length - 1].role === 'user', 'The conversation must start and end with a user message'),
  })
  .strict();

/** AI layer: the assistant and AI-written text (need a provider key), forecast and price estimate (never do). */
export const aiRoutes = Router();

aiRoutes.get('/ai/status', h(async (req, res) => sendSuccess(res, { ...(await aiService.status(authOf(req))), tools: assistantService.toolNames(authOf(req)) })));
aiRoutes.post('/ai/assistant', aiLimiter, validate({ body: assistantSchema }), h(async (req, res) => sendSuccess(res, await assistantService.ask(authOf(req), req.body.messages))));
aiRoutes.post('/ai/properties/:id/description', aiLimiter, can(P.PROPERTIES_READ), validate({ params: idParams, body: z.object({ language, useAi: z.boolean().optional() }).strict() }), h(async (req, res) => sendSuccess(res, await aiService.describeProperty(authOf(req), req.params.id, req.body))));
aiRoutes.get('/ai/properties/:id/price-estimate', can(P.PROPERTIES_READ), validate({ params: idParams }), h(async (req, res) => sendSuccess(res, await aiService.priceEstimate(authOf(req), req.params.id))));
aiRoutes.post('/ai/clients/:id/brief', aiLimiter, can(P.CLIENTS_READ), validate({ params: idParams, body: z.object({ language }).strict() }), h(async (req, res) => sendSuccess(res, await aiService.clientBrief(authOf(req), req.params.id, req.body.language))));
aiRoutes.get('/ai/forecast', h(async (req, res) => sendSuccess(res, await aiService.forecast(authOf(req)))));
