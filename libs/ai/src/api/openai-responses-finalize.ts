import type {
  ResponseOutputItem,
  ResponseStatus,
  ResponseStreamEvent,
  ResponseUsage,
} from "openai/resources/responses/responses.js";

import modelsModule from "../models.ts";
import type typesModule from "../types.types.ts";
import type openaiResponsesStreamStateTypes from "./openai-responses-stream-state.types.ts";

const { calculateCost } = modelsModule;

type TerminalResponse = Extract<
  ResponseStreamEvent,
  { type: "response.completed" | "response.incomplete" }
>["response"];

const hasText = (value: string | null | undefined): value is string =>
  value !== undefined && value !== null && value !== "";

function backfillReasoningSignatures(
  blocksById: ReadonlyMap<string, typesModule.ThinkingContent>,
  responseOutput: readonly ResponseOutputItem[],
): void {
  for (const item of responseOutput) {
    if (item.type !== "reasoning" || !hasText(item.encrypted_content)) continue;
    const block = blocksById.get(item.id);
    if (!hasText(block?.thinkingSignature)) continue;
    const storedItem = JSON.parse(block.thinkingSignature) as typeof item;
    if (hasText(storedItem.encrypted_content)) continue;
    block.thinkingSignature = JSON.stringify({
      ...storedItem,
      encrypted_content: item.encrypted_content,
    });
  }
}

function usageOf(usage: ResponseUsage): typesModule.Usage {
  const inputDetails = usage.input_tokens_details as
    | { cached_tokens?: number; cache_write_tokens?: number }
    | undefined;
  const cachedTokens = inputDetails?.cached_tokens || 0;
  const cacheWriteTokens = inputDetails?.cache_write_tokens || 0;
  return {
    cacheRead: cachedTokens,
    cacheWrite: cacheWriteTokens,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: Math.max(0, (usage.input_tokens || 0) - cachedTokens - cacheWriteTokens),
    output: usage.output_tokens || 0,
    reasoning: usage.output_tokens_details?.reasoning_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  };
}

function applyPricing<TApi extends typesModule.Api>(
  { model, options, output }: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
  response: TerminalResponse,
): void {
  calculateCost(model, output.usage);
  if (options?.applyServiceTierPricing === undefined) return;
  const serviceTier =
    options.resolveServiceTier === undefined
      ? (response.service_tier ?? options.serviceTier)
      : options.resolveServiceTier(response.service_tier, options.serviceTier);
  options.applyServiceTierPricing(output.usage, serviceTier);
}

function incompleteMessage(incompleteReason: string | undefined): string {
  return incompleteReason !== undefined && incompleteReason !== ""
    ? `Response incomplete: ${incompleteReason}`
    : "Response incomplete without a provider reason";
}

function mapStopReason(
  status: ResponseStatus | undefined,
  incompleteReason: string | undefined,
): { stopReason: typesModule.StopReason; errorMessage?: string } {
  switch (status) {
    case "incomplete":
      return incompleteReason === "max_output_tokens"
        ? { stopReason: "length" }
        : { errorMessage: incompleteMessage(incompleteReason), stopReason: "error" };
    case "failed":
    case "cancelled":
      return { stopReason: "error" };
    case undefined:
    case "completed":
    case "in_progress":
    case "queued":
      return { stopReason: "stop" };
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled stop reason: ${exhaustive}`);
    }
  }
}

function applyStatus(output: typesModule.AssistantMessage, response: TerminalResponse): void {
  const status = response.status;
  const details = response.incomplete_details as { reason?: unknown } | null | undefined;
  const reason = typeof details?.reason === "string" ? details.reason : undefined;
  output.rawStopReason = reason !== undefined && reason !== "" ? `${status}.${reason}` : status;
  const mapped = mapStopReason(status, reason);
  output.stopReason = mapped.stopReason;
  if (mapped.errorMessage === undefined) delete output.errorMessage;
  else output.errorMessage = mapped.errorMessage;
  if (output.stopReason === "stop" && output.content.some((b) => b.type === "toolCall")) {
    output.stopReason = "toolUse";
  }
}

function finalizeResponse<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
) {
  return (response: TerminalResponse): void => {
    state.sawTerminalResponseEvent = true;
    backfillReasoningSignatures(state.reasoningBlocksById, response.output ?? []);
    if (response.id !== "") state.output.responseId = response.id;
    if (response.usage !== undefined) state.output.usage = usageOf(response.usage);
    applyPricing(state, response);
    applyStatus(state.output, response);
  };
}

const openaiResponsesFinalize = {
  finalizeResponse,
};

export default openaiResponsesFinalize;
