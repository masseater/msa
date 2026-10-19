import type OpenAI from "openai";

import type { ChatTemplateKwargValue, Model, ThinkingTokenBudgetField } from "../types.ts";
import type {
  OpenAICompletionsOptions,
  ResolvedChatTemplateKwargValue,
  ResolvedOpenAICompletionsCompat,
} from "./openai-completions-types.ts";
import { clampThinkingBudgetToAnswerRoom, thinkingBudgetForLevel } from "./simple-options.ts";

interface ThinkingInput {
  readonly params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
  readonly model: Model<"openai-completions">;
  readonly options: OpenAICompletionsOptions | undefined;
  readonly compat: ResolvedOpenAICompletionsCompat;
  readonly thinkingBudget: number | undefined;
}

function resolveThinkingTokenBudgetField(
  compat: Pick<
    ResolvedOpenAICompletionsCompat,
    "thinkingTokenBudgetField" | "supportsThinkingTokenBudget"
  >,
): ThinkingTokenBudgetField | undefined {
  if (compat.thinkingTokenBudgetField !== undefined) return compat.thinkingTokenBudgetField;
  if (compat.supportsThinkingTokenBudget === true) return "thinking_token_budget";
  return undefined;
}

function resolveClampedThinkingBudget(input: {
  model: Model<"openai-completions">;
  options: OpenAICompletionsOptions | undefined;
  params: { max_tokens?: number | null; max_completion_tokens?: number | null };
}): number | undefined {
  const { model, options, params } = input;
  if (options?.reasoningEffort === undefined || !model.reasoning) return undefined;
  const ceiling = params.max_tokens ?? params.max_completion_tokens ?? model.maxTokens;
  const budget = clampThinkingBudgetToAnswerRoom(
    thinkingBudgetForLevel(options.reasoningEffort, options.thinkingBudgets),
    ceiling,
  );
  return budget > 0 ? budget : undefined;
}

function resolveChatTemplateKwargValue(
  model: Model<"openai-completions">,
  options: OpenAICompletionsOptions | undefined,
  value: ChatTemplateKwargValue,
  thinkingBudget?: number,
): ResolvedChatTemplateKwargValue | undefined {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const reasoningEffort = options?.reasoningEffort;
  if (reasoningEffort === undefined && value.omitWhenOff === true) {
    return undefined;
  }
  if (value.$var === "thinking.enabled") {
    return reasoningEffort !== undefined;
  }
  if (value.$var === "thinking.budget") {
    return thinkingBudget;
  }

  const mappedValue =
    reasoningEffort === undefined
      ? model.thinkingLevelMap?.off
      : model.thinkingLevelMap?.[reasoningEffort];
  return mappedValue === undefined
    ? reasoningEffort
    : typeof mappedValue === "string"
      ? mappedValue
      : undefined;
}

function buildChatTemplateValues(
  model: Model<"openai-completions">,
  options: OpenAICompletionsOptions | undefined,
  values: Record<string, ChatTemplateKwargValue>,
  thinkingBudget?: number,
): Record<string, ResolvedChatTemplateKwargValue> | undefined {
  const resolvedValues: Record<string, ResolvedChatTemplateKwargValue> = {};

  for (const [key, value] of Object.entries(values)) {
    const resolved = resolveChatTemplateKwargValue(model, options, value, thinkingBudget);
    if (resolved !== undefined) {
      resolvedValues[key] = resolved;
    }
  }

  return Object.keys(resolvedValues).length > 0 ? resolvedValues : undefined;
}

function applyQwenThinking(input: ThinkingInput): void {
  const { params, model, options, compat } = input;
  (params as any).enable_thinking = options?.reasoningEffort !== undefined;
  if (options?.reasoningEffort !== undefined && compat.supportsReasoningEffort) {
    const effort = model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
    if (typeof effort === "string") {
      (params as any).reasoning_effort = effort;
    }
  }
}

function applyQwenChatTemplate(input: ThinkingInput): void {
  (input.params as any).chat_template_kwargs = {
    enable_thinking: input.options?.reasoningEffort !== undefined,
    preserve_thinking: true,
  };
}

function applyChatTemplate(input: ThinkingInput): void {
  const { params, model, options, compat, thinkingBudget } = input;
  const chatTemplateKwargs = buildChatTemplateValues(
    model,
    options,
    compat.chatTemplateKwargs,
    thinkingBudget,
  );
  if (chatTemplateKwargs !== undefined) {
    (params as any).chat_template_kwargs = chatTemplateKwargs;
  }
}

function applyDeepseekThinking(input: ThinkingInput): void {
  const { params, model, options, compat } = input;
  if (options?.reasoningEffort !== undefined) {
    (params as any).thinking = { type: "enabled" };
  } else if (model.thinkingLevelMap?.off !== null) {
    (params as any).thinking = { type: "disabled" };
  }
  if (options?.reasoningEffort !== undefined && compat.supportsReasoningEffort) {
    (params as any).reasoning_effort =
      model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
  }
}

function applyOpenRouterThinking(input: ThinkingInput): void {
  const { params, model, options } = input;
  const openRouterParams = params as typeof params & { reasoning?: { effort?: string } };
  if (options?.reasoningEffort !== undefined) {
    openRouterParams.reasoning = {
      effort: model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
    };
  } else if (model.thinkingLevelMap?.off !== null) {
    openRouterParams.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" };
  }
}

function applyStringThinking(input: ThinkingInput): void {
  const { params, model, options } = input;
  const stringThinkingParams = params as typeof params & { thinking?: string };
  if (options?.reasoningEffort !== undefined) {
    stringThinkingParams.thinking =
      model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
  } else if (model.thinkingLevelMap?.off !== null) {
    stringThinkingParams.thinking = model.thinkingLevelMap?.off ?? "none";
  }
}

function applyDefaultReasoningEffort(input: ThinkingInput): void {
  const { params, model, options, compat } = input;
  if (!compat.supportsReasoningEffort) return;
  if (options?.reasoningEffort !== undefined) {
    (params as any).reasoning_effort =
      model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
    return;
  }
  const offValue = model.thinkingLevelMap?.off;
  if (typeof offValue === "string") {
    (params as any).reasoning_effort = offValue;
  }
}

function applyThinkingParams(input: ThinkingInput): void {
  if (!input.model.reasoning) return;
  switch (input.compat.thinkingFormat) {
    case "qwen":
      return applyQwenThinking(input);
    case "qwen-chat-template":
      return applyQwenChatTemplate(input);
    case "chat-template":
      return applyChatTemplate(input);
    case "deepseek":
      return applyDeepseekThinking(input);
    case "openrouter":
      return applyOpenRouterThinking(input);
    case "string-thinking":
      return applyStringThinking(input);
    default:
      return applyDefaultReasoningEffort(input);
  }
}

export { applyThinkingParams, resolveClampedThinkingBudget, resolveThinkingTokenBudgetField };
