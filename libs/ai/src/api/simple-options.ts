import { Function } from "effect";

import modelsModule from "../models.ts";
import type typesModule from "../types.types.ts";
import estimate from "../utils/estimate.ts";

const { estimateContextTokens } = estimate;
const { clampThinkingLevel } = modelsModule;

const CONTEXT_SAFETY_TOKENS = 4096;
const MIN_MAX_TOKENS = 1;

const clampMaxTokensToContext: {
  (
    context: typesModule.TranscriptContext,
    maxTokens: number,
  ): (model: typesModule.Model<typesModule.Api>) => number;
  (
    model: typesModule.Model<typesModule.Api>,
    context: typesModule.TranscriptContext,
    maxTokens: number,
  ): number;
} = Function.dual(
  3,
  function (
    model: typesModule.Model<typesModule.Api>,
    context: typesModule.TranscriptContext,
    maxTokens: number,
  ): number {
    if (model.contextWindow <= 0) return Math.max(MIN_MAX_TOKENS, maxTokens);
    const available =
      model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
    return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
  },
);

const resolveSamplingParams: {
  (
    thinkingLevel: typesModule.ModelThinkingLevel,
    requestParams?: typesModule.SamplingParams,
  ): (model: typesModule.Model<typesModule.Api>) => typesModule.SamplingParams | undefined;
  (
    model: typesModule.Model<typesModule.Api>,
    thinkingLevel: typesModule.ModelThinkingLevel,
    requestParams?: typesModule.SamplingParams,
  ): typesModule.SamplingParams | undefined;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function (
    model: typesModule.Model<typesModule.Api>,
    thinkingLevel: typesModule.ModelThinkingLevel,
    requestParams?: typesModule.SamplingParams,
  ): typesModule.SamplingParams | undefined {
    const effectiveThinkingLevel = clampThinkingLevel(model, thinkingLevel);
    const thinkingLevelParams = model.samplingParamsByThinkingLevel?.[effectiveThinkingLevel];
    return model.samplingParams !== undefined ||
      thinkingLevelParams !== undefined ||
      requestParams !== undefined
      ? { ...model.samplingParams, ...thinkingLevelParams, ...requestParams }
      : undefined;
  },
);

const buildBaseOptions: {
  (
    context: typesModule.TranscriptContext,
    options?: typesModule.SimpleStreamOptions,
    apiKey?: string,
  ): (model: typesModule.Model<typesModule.Api>) => typesModule.StreamOptions;
  (
    model: typesModule.Model<typesModule.Api>,
    context: typesModule.TranscriptContext,
    options?: typesModule.SimpleStreamOptions,
    apiKey?: string,
  ): typesModule.StreamOptions;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function (
    model: typesModule.Model<typesModule.Api>,
    context: typesModule.TranscriptContext,
    options?: typesModule.SimpleStreamOptions,
    apiKey?: string,
  ): typesModule.StreamOptions {
    const samplingParams = resolveSamplingParams(
      model,
      options?.reasoning ?? "off",
      options?.samplingParams,
    );
    return {
      apiKey: apiKey || options?.apiKey,
      cacheRetention: options?.cacheRetention,
      env: options?.env,
      fetch: options?.fetch,
      headers: options?.headers,
      maxRetries: options?.maxRetries,
      maxRetryDelayMs: options?.maxRetryDelayMs,
      maxTokens: clampMaxTokensToContext(model, context, options?.maxTokens ?? model.maxTokens),
      metadata: options?.metadata,
      onPayload: options?.onPayload,
      onProviderStreamEvent: options?.onProviderStreamEvent,
      onResponse: options?.onResponse,
      samplingParams,
      sessionId: options?.sessionId,
      signal: options?.signal,
      telemetryContext: options?.telemetryContext,
      temperature: options?.temperature,
      timeoutMs: options?.timeoutMs,
      transport: options?.transport,
      websocketConnectTimeoutMs: options?.websocketConnectTimeoutMs,
    };
  },
);

const MIN_ANSWER_TOKENS = 1024;

const DEFAULT_THINKING_BUDGETS: typesModule.ThinkingBudgets = {
  high: 16384,
  low: 2048,
  medium: 8192,
  minimal: 1024,
};

function clampReasoning(
  effort: typesModule.ThinkingLevel | undefined,
): Exclude<typesModule.ThinkingLevel, "xhigh" | "max"> | undefined {
  return effort === "xhigh" || effort === "max" ? "high" : effort;
}

const thinkingBudgetForLevel: {
  (
    customBudgets?: typesModule.ThinkingBudgets,
  ): (reasoningLevel: typesModule.ThinkingLevel) => number;
  (reasoningLevel: typesModule.ThinkingLevel, customBudgets?: typesModule.ThinkingBudgets): number;
} = Function.dual(
  (args) => typeof args[0] === "string",
  function (
    reasoningLevel: typesModule.ThinkingLevel,
    customBudgets?: typesModule.ThinkingBudgets,
  ): number {
    const budgets = { ...DEFAULT_THINKING_BUDGETS, ...customBudgets };
    const level = clampReasoning(reasoningLevel)!;
    return budgets[level]!;
  },
);

const clampThinkingBudgetToAnswerRoom: {
  (ceiling: number): (thinkingBudget: number) => number;
  (thinkingBudget: number, ceiling: number): number;
} = Function.dual(2, function (thinkingBudget: number, ceiling: number): number {
  return Math.min(thinkingBudget, Math.max(0, ceiling - MIN_ANSWER_TOKENS));
});

const adjustMaxTokensForThinking: {
  (
    modelMaxTokens: number,
    reasoningLevel: typesModule.ThinkingLevel,
    customBudgets?: typesModule.ThinkingBudgets,
  ): (baseMaxTokens: number | undefined) => { maxTokens: number; thinkingBudget: number };
  (
    baseMaxTokens: number | undefined,
    modelMaxTokens: number,
    reasoningLevel: typesModule.ThinkingLevel,
    customBudgets?: typesModule.ThinkingBudgets,
  ): { maxTokens: number; thinkingBudget: number };
} = Function.dual(
  (args) => typeof args[1] === "number",
  function (
    baseMaxTokens: number | undefined,
    modelMaxTokens: number,
    reasoningLevel: typesModule.ThinkingLevel,
    customBudgets?: typesModule.ThinkingBudgets,
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
  },
);

const simpleOptions = {
  DEFAULT_THINKING_BUDGETS,
  MIN_ANSWER_TOKENS,
  adjustMaxTokensForThinking,
  buildBaseOptions,
  clampMaxTokensToContext,
  clampReasoning,
  clampThinkingBudgetToAnswerRoom,
  resolveSamplingParams,
  thinkingBudgetForLevel,
};

export default simpleOptions;
