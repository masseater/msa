import { Function } from "effect";

import { clampThinkingLevel } from "../models.ts";
import type {
  Api,
  Model,
  ModelThinkingLevel,
  SamplingParams,
  SimpleStreamOptions,
  StreamOptions,
  ThinkingBudgets,
  ThinkingLevel,
  TranscriptContext,
} from "../types.ts";
import { estimateContextTokens } from "../utils/estimate.ts";

const CONTEXT_SAFETY_TOKENS = 4096;
const MIN_MAX_TOKENS = 1;

export const clampMaxTokensToContext: {
  (context: TranscriptContext, maxTokens: number): (model: Model<Api>) => number;
  (model: Model<Api>, context: TranscriptContext, maxTokens: number): number;
} = Function.dual(
  3,
  function (model: Model<Api>, context: TranscriptContext, maxTokens: number): number {
    if (model.contextWindow <= 0) return Math.max(MIN_MAX_TOKENS, maxTokens);
    const available =
      model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
    return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
  },
);

export function resolveSamplingParams(
  model: Model<Api>,
  thinkingLevel: ModelThinkingLevel,
  requestParams?: SamplingParams,
): SamplingParams | undefined {
  const effectiveThinkingLevel = clampThinkingLevel(model, thinkingLevel);
  const thinkingLevelParams = model.samplingParamsByThinkingLevel?.[effectiveThinkingLevel];
  return model.samplingParams !== undefined ||
    thinkingLevelParams !== undefined ||
    requestParams !== undefined
    ? { ...model.samplingParams, ...thinkingLevelParams, ...requestParams }
    : undefined;
}

export function buildBaseOptions(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
  apiKey?: string,
): StreamOptions {
  const samplingParams = resolveSamplingParams(
    model,
    options?.reasoning ?? "off",
    options?.samplingParams,
  );
  return {
    temperature: options?.temperature,
    samplingParams,
    maxTokens: clampMaxTokensToContext(model, context, options?.maxTokens ?? model.maxTokens),
    signal: options?.signal,
    telemetryContext: options?.telemetryContext,
    apiKey: apiKey || options?.apiKey,
    fetch: options?.fetch,
    transport: options?.transport,
    cacheRetention: options?.cacheRetention,
    sessionId: options?.sessionId,
    headers: options?.headers,
    onPayload: options?.onPayload,
    onResponse: options?.onResponse,
    onProviderStreamEvent: options?.onProviderStreamEvent,
    timeoutMs: options?.timeoutMs,
    websocketConnectTimeoutMs: options?.websocketConnectTimeoutMs,
    maxRetries: options?.maxRetries,
    maxRetryDelayMs: options?.maxRetryDelayMs,
    metadata: options?.metadata,
    env: options?.env,
  };
}

export const MIN_ANSWER_TOKENS = 1024;

export const DEFAULT_THINKING_BUDGETS: ThinkingBudgets = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
};

export function clampReasoning(
  effort: ThinkingLevel | undefined,
): Exclude<ThinkingLevel, "xhigh" | "max"> | undefined {
  return effort === "xhigh" || effort === "max" ? "high" : effort;
}

export function thinkingBudgetForLevel(
  reasoningLevel: ThinkingLevel,
  customBudgets?: ThinkingBudgets,
): number {
  const budgets = { ...DEFAULT_THINKING_BUDGETS, ...customBudgets };
  const level = clampReasoning(reasoningLevel)!;
  return budgets[level]!;
}

export const clampThinkingBudgetToAnswerRoom: {
  (ceiling: number): (thinkingBudget: number) => number;
  (thinkingBudget: number, ceiling: number): number;
} = Function.dual(2, function (thinkingBudget: number, ceiling: number): number {
  return Math.min(thinkingBudget, Math.max(0, ceiling - MIN_ANSWER_TOKENS));
});

export function adjustMaxTokensForThinking(
  baseMaxTokens: number | undefined,
  modelMaxTokens: number,
  reasoningLevel: ThinkingLevel,
  customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
  let thinkingBudget = thinkingBudgetForLevel(reasoningLevel, customBudgets);
  const maxTokens =
    baseMaxTokens === undefined
      ? modelMaxTokens
      : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

  if (maxTokens <= thinkingBudget) {
    thinkingBudget = clampThinkingBudgetToAnswerRoom(thinkingBudget, maxTokens);
  }

  return { maxTokens, thinkingBudget };
}
