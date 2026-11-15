import Anthropic from '@anthropic-ai/sdk';
import { ERROR_CODES } from '@recrm/shared';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { AppError } from '../../../utils/AppError';
import type { AiProvider, ReportCall } from './types';

type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;

/** The slice of the SDK client this adapter uses (tests substitute a fake). */
export interface MessagesClient {
  beta: { messages: { create(params: CreateParams): Promise<Message> } };
}

let client: MessagesClient | null | undefined;
function getClient(): MessagesClient | null {
  if (client === undefined) client = env.ANTHROPIC_API_KEY ? (new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 }) as unknown as MessagesClient) : null;
  return client;
}
/** Tests only: swap in a fake client (null = not configured, undefined = back to env). */
export function useAnthropicClient(fake: MessagesClient | null | undefined) {
  client = fake;
}

const textOf = (m: Message) =>
  m.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

/** One Messages API call with server-side refusal fallbacks, usage reporting and clear errors. */
async function call(params: Omit<CreateParams, 'model' | 'betas' | 'fallbacks'>, report: ReportCall): Promise<Message> {
  const c = getClient();
  if (!c) throw new AppError(503, ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'AI is not set up on this server yet. Ask your administrator to add an Anthropic API key.');
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
    await report({ model: env.AI_MODEL, inputTokens: 0, outputTokens: 0, outcome: 'ERROR' });
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
  const usage = { model: message.model ?? env.AI_MODEL, inputTokens: message.usage?.input_tokens ?? 0, outputTokens: message.usage?.output_tokens ?? 0 };
  if (message.stop_reason === 'refusal') {
    await report({ ...usage, outcome: 'REFUSED' });
    throw new AppError(422, ERROR_CODES.AI_DECLINED, 'The AI declined this request. Try rephrasing it.');
  }
  await report({ ...usage, outcome: 'OK' });
  return message;
}

export const anthropicProvider: AiProvider = {
  name: 'anthropic',
  configured: () => getClient() !== null,
  model: () => env.AI_MODEL,

  async generateJson<T>(req: Parameters<AiProvider['generateJson']>[0], report: ReportCall): Promise<T> {
    const m = await call(
      {
        max_tokens: req.maxTokens,
        output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
      },
      report,
    );
    try {
      return JSON.parse(textOf(m)) as T;
    } catch {
      throw new AppError(502, ERROR_CODES.AI_UNAVAILABLE, 'The AI returned an unreadable answer. Please try again.');
    }
  },

  async runTools(req, report) {
    const tools: Anthropic.Beta.BetaTool[] = req.tools.map((t) => ({ name: t.name, description: t.description, strict: true, input_schema: t.inputSchema as Anthropic.Beta.BetaTool['input_schema'] }));
    // Assistant turns are appended exactly as returned (thinking blocks included) — never rewritten.
    const messages: Anthropic.Beta.BetaMessageParam[] = req.history.map((m) => ({ role: m.role, content: m.content }));
    for (let step = 0; step < req.maxSteps; step++) {
      const res = await call(
        {
          max_tokens: req.maxTokens,
          output_config: { effort: req.effort },
          // Stable instructions first (cached), then per-request context.
          system: [
            { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: req.context },
          ],
          tools,
          messages,
        },
        report,
      );
      messages.push({ role: 'assistant', content: res.content });
      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !calls.length) return { text: textOf(res), exhausted: false };
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
        calls.map(async (c) => {
          const r = await req.runTool(c.name, (c.input ?? {}) as Record<string, unknown>);
          return { type: 'tool_result' as const, tool_use_id: c.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
        }),
      );
      messages.push({ role: 'user', content: results });
    }
    return { text: '', exhausted: true };
  },
};
