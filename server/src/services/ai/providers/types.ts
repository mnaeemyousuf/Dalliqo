/**
 * Provider-neutral contract for the AI layer. The rest of the app (features, assistant tools,
 * permission filtering, allowance and usage metering) depends only on this — switching provider
 * means implementing these two operations and registering the provider (see ./index.ts).
 */

export type AiEffort = 'low' | 'medium' | 'high';

export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the tool input (object, every property required, no additional properties). */
  inputSchema: Record<string, unknown>;
}

/** One provider call, reported for metering whatever its outcome. */
export interface AiCallReport {
  model: string;
  inputTokens: number;
  outputTokens: number;
  outcome: 'OK' | 'REFUSED' | 'ERROR';
}

export type ReportCall = (r: AiCallReport) => Promise<void>;

export interface GenerateJsonRequest {
  system: string;
  prompt: string;
  /** JSON Schema the answer must follow. */
  schema: Record<string, unknown>;
  effort: AiEffort;
  maxTokens: number;
}

export interface ToolLoopRequest {
  /** Stable instructions (providers may cache them). */
  system: string;
  /** Per-request context (who is asking, today's date). */
  context: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  tools: AiToolSpec[];
  /** Executes a tool the model asked for; never throws (errors come back as isError results). */
  runTool(name: string, input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }>;
  maxSteps: number;
  effort: AiEffort;
  maxTokens: number;
}

export interface ToolLoopResult {
  text: string;
  /** True when the step limit ran out before a final answer. */
  exhausted: boolean;
}

export interface AiProvider {
  readonly name: string;
  configured(): boolean;
  model(): string;
  /** Structured answer parsed into T. Throws AppError (AI_DECLINED, AI_UNAVAILABLE, …) on failure. */
  generateJson<T>(req: GenerateJsonRequest, report: ReportCall): Promise<T>;
  /** Runs the model ↔ tools loop until a final text answer (or the step limit). */
  runTools(req: ToolLoopRequest, report: ReportCall): Promise<ToolLoopResult>;
}
