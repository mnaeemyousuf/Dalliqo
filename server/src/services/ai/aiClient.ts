import Anthropic from '@anthropic-ai/sdk';
import { Types } from 'mongoose';
import { ERROR_CODES, type AiFeature } from '@recrm/shared';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AiUsage } from '../../models/AiUsage';
import type { TenantContext } from '../../types/context';
import { AppError } from '../../utils/AppError';

type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;

/** The slice of the SDK client the AI layer uses (lets tests substitute a fake). */
export interface MessagesClient {
  beta: { messages: { create(params: CreateParams): Promise<Message> } };
}

let client: MessagesClient | null | undefined;

function getClient(): MessagesClient | null {
  if (client === undefined) client = env.ANTHROPIC_API_KEY ? (new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 }) as unknown as MessagesClient) : null;
  return client;
}

export const aiClient = {
  configured: () => getClient() !== null,
  model: () => env.AI_MODEL,
  /** Tests only: swap in a fake client (null = not configured, undefined = back to env). */
  use(fake: MessagesClient | null | undefined) {
    client = fake;
  },

  async usedThisMonth(businessId: string): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    return AiUsage.countDocuments({ businessId: new Types.ObjectId(businessId), createdAt: { $gte: start } });
  },

  /**
   * One Messages API call on behalf of a business: checks the monthly allowance, opts into
   * server-side refusal fallbacks, records usage, and turns provider failures into clear errors.
   */
  async create(ctx: TenantContext, feature: AiFeature, params: Omit<CreateParams, 'model' | 'betas' | 'fallbacks'>): Promise<Message> {
    const c = getClient();
    if (!c) throw new AppError(503, ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'AI is not set up on this server yet. Ask your administrator to add an Anthropic API key.');
    if ((await aiClient.usedThisMonth(ctx.businessId)) >= env.AI_MONTHLY_LIMIT) {
      throw new AppError(429, ERROR_CODES.AI_LIMIT_REACHED, `Your business has used this month's AI allowance (${env.AI_MONTHLY_LIMIT} requests). It resets on the 1st.`);
    }
    const record = (outcome: 'OK' | 'REFUSED' | 'ERROR', m?: Message) =>
      AiUsage.create({
        businessId: ctx.businessId,
        userId: ctx.userId,
        feature,
        model: m?.model ?? env.AI_MODEL,
        inputTokens: m?.usage?.input_tokens ?? 0,
        outputTokens: m?.usage?.output_tokens ?? 0,
        outcome,
      }).catch((err) => logger.warn({ err }, 'Could not record AI usage'));
    let message: Message;
    try {
      message = await c.beta.messages.create({
        ...params,
        model: env.AI_MODEL,
        // If a safety classifier declines, the API retries on a suitable fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      await record('ERROR');
      if (err instanceof Anthropic.RateLimitError) throw new AppError(429, ERROR_CODES.AI_UNAVAILABLE, 'The AI service is busy. Please try again in a minute.');
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        logger.error({ err: (err as Error).message }, 'Anthropic credentials rejected');
        throw new AppError(503, ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'The AI service rejected this server’s credentials. Ask your administrator to check the API key.');
      }
      if (err instanceof Anthropic.BadRequestError) {
        logger.error({ err: (err as Error).message }, 'Anthropic rejected the request');
        throw new AppError(502, ERROR_CODES.AI_UNAVAILABLE, 'The AI service could not handle this request.');
      }
      if (err instanceof Anthropic.APIError) {
        logger.warn({ status: err.status }, 'Anthropic API error');
        throw new AppError(502, ERROR_CODES.AI_UNAVAILABLE, 'The AI service is not responding right now. Please try again.');
      }
      throw err;
    }
    if (message.stop_reason === 'refusal') {
      await record('REFUSED', message);
      throw new AppError(422, ERROR_CODES.AI_DECLINED, 'The AI declined this request. Try rephrasing it.');
    }
    await record('OK', message);
    return message;
  },
};

export function textOf(m: Message): string {
  return m.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Structured output: parse the JSON answer (the API constrains it to the schema). */
export function jsonOf<T>(m: Message): T {
  const t = textOf(m);
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new AppError(502, ERROR_CODES.AI_UNAVAILABLE, 'The AI returned an unreadable answer. Please try again.');
  }
}
