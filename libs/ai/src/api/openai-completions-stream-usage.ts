import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";

import modelsModule from "../models.ts";
import type typesModule from "../types.types.ts";
import type openaiCompletionsStreamUsageTypes from "./openai-completions-stream-usage.types.ts";

const { calculateCost } = modelsModule;

function parseChunkUsage(input: {
  rawUsage: openaiCompletionsStreamUsageTypes.RawUsage;
  model: typesModule.Model<"openai-completions">;
}): typesModule.AssistantMessage["usage"] {
  const { rawUsage, model } = input;
  const promptTokens = rawUsage.prompt_tokens || 0;
  const cacheReadTokens =
    rawUsage.prompt_tokens_details?.cached_tokens ??
    rawUsage.prompt_cache_hit_tokens ??
    rawUsage.cached_tokens ??
    0;
  const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;

  const inputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
  const outputTokens = rawUsage.completion_tokens || 0;
  const usage: typesModule.AssistantMessage["usage"] = {
    cacheRead: cacheReadTokens,
    cacheWrite: cacheWriteTokens,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: inputTokens,
    output: outputTokens,
    reasoning: rawUsage.completion_tokens_details?.reasoning_tokens || 0,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
  };
  calculateCost(model, usage);
  return usage;
}

function mapStopReason(reason: ChatCompletionChunk.Choice["finish_reason"] | string): {
  stopReason: typesModule.StopReason;
  errorMessage?: string;
} {
  if (reason === null) return { stopReason: "stop" };
  switch (reason) {
    case "stop":
    case "end":
      return { stopReason: "stop" };
    case "length":
      return { stopReason: "length" };
    case "function_call":
    case "tool_calls":
      return { stopReason: "toolUse" };
    case "content_filter":
      return { errorMessage: "Provider finish_reason: content_filter", stopReason: "error" };
    case "network_error":
      return { errorMessage: "Provider finish_reason: network_error", stopReason: "error" };
    default:
      return {
        errorMessage: `Provider finish_reason: ${reason}`,
        stopReason: "error",
      };
  }
}

const openaiCompletionsStreamUsage = {
  mapStopReason,
  parseChunkUsage,
};

export default openaiCompletionsStreamUsage;
