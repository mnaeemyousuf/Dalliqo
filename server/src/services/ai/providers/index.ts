import { env } from '../../../config/env';
import { anthropicProvider } from './anthropic';
import type { AiProvider } from './types';

/**
 * Registered AI providers, chosen with AI_PROVIDER. To add one: implement AiProvider
 * (generateJson + runTools), add it here and to the AI_PROVIDER enum in config/env.ts.
 */
export const AI_PROVIDERS: Record<string, AiProvider> = {
  anthropic: anthropicProvider,
};

export function activeProvider(): AiProvider {
  return AI_PROVIDERS[env.AI_PROVIDER] ?? anthropicProvider;
}

export type { AiProvider } from './types';
