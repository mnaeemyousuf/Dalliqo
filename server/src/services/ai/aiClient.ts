import { Types } from 'mongoose';
import { ERROR_CODES, type AiFeature } from '@recrm/shared';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AiUsage } from '../../models/AiUsage';
import type { TenantContext } from '../../types/context';
import { AppError } from '../../utils/AppError';
import { useAnthropicClient, type MessagesClient } from './providers/anthropic';
import { activeProvider } from './providers';
import type { GenerateJsonRequest, ReportCall, ToolLoopRequest, ToolLoopResult } from './providers/types';

export type { MessagesClient } from './providers/anthropic';

/**
 * Gateway to the configured AI provider: enforces the monthly allowance and records every call
 * (feature, model, tokens, outcome) whichever provider handles it.
 */
export const aiClient = {
  configured: () => activeProvider().configured(),
  model: () => activeProvider().model(),
  provider: () => activeProvider().name,
  /** Tests only: swap the Anthropic SDK client for a fake (null = not configured, undefined = env). */
  use(fake: MessagesClient | null | undefined) {
    useAnthropicClient(fake);
  },

  async usedThisMonth(businessId: string): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    return AiUsage.countDocuments({ businessId: new Types.ObjectId(businessId), createdAt: { $gte: start } });
  },

  async generateJson<T>(ctx: TenantContext, feature: AiFeature, req: GenerateJsonRequest): Promise<T> {
    await aiClient.assertReady(ctx);
    return activeProvider().generateJson<T>(req, reporter(ctx, feature));
  },

  async runTools(ctx: TenantContext, feature: AiFeature, req: ToolLoopRequest): Promise<ToolLoopResult> {
    await aiClient.assertReady(ctx);
    return activeProvider().runTools(req, reporter(ctx, feature));
  },

  async assertReady(ctx: TenantContext) {
    if (!activeProvider().configured()) throw new AppError(503, ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'AI is not set up on this server yet. Ask your administrator to add an AI provider key.');
    if ((await aiClient.usedThisMonth(ctx.businessId)) >= env.AI_MONTHLY_LIMIT) {
      throw new AppError(429, ERROR_CODES.AI_LIMIT_REACHED, `Your business has used this month's AI allowance (${env.AI_MONTHLY_LIMIT} requests). It resets on the 1st.`);
    }
  },
};

function reporter(ctx: TenantContext, feature: AiFeature): ReportCall {
  return async (r) => {
    await AiUsage.create({ businessId: ctx.businessId, userId: ctx.userId, feature, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, outcome: r.outcome }).catch((err) => logger.warn({ err }, 'Could not record AI usage'));
  };
}
