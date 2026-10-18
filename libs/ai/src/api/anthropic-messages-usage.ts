import type {
  BetaInputTransformation,
  BetaRawMessageStreamEvent as RawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import { calculateCost } from "../models.ts";
import type { AssistantMessage, Model } from "../types.ts";
import { mapStopReason } from "./anthropic-messages-tools.ts";

interface UsageState {
  readonly output: AssistantMessage;
  usageModel: Model<"anthropic-messages">;
  inputTransformations: BetaInputTransformation[] | undefined;
}

type UsageEvent = Extract<RawMessageStreamEvent, { type: "message_delta" }>;

function applyNumber(value: number | null | undefined, set: (next: number) => void): void {
  if (value === undefined || value === null) return;
  set(value);
}

function applyUsage(usage: AssistantMessage["usage"], event: UsageEvent): void {
  const usageDelta = event.usage;
  if (usageDelta === undefined || usageDelta === null) return;
  applyNumber(usageDelta.input_tokens, (next) => {
    usage.input = next;
  });
  applyNumber(usageDelta.output_tokens, (next) => {
    usage.output = next;
  });
  applyNumber(usageDelta.cache_read_input_tokens, (next) => {
    usage.cacheRead = next;
  });
  applyNumber(usageDelta.cache_creation_input_tokens, (next) => {
    usage.cacheWrite = next;
  });
  const cacheCreation = (
    usageDelta as typeof usageDelta & {
      cache_creation?: { ephemeral_1h_input_tokens?: number };
    }
  ).cache_creation;
  applyNumber(cacheCreation?.ephemeral_1h_input_tokens, (next) => {
    usage.cacheWrite1h = next;
  });
  applyNumber(usageDelta.output_tokens_details?.thinking_tokens, (next) => {
    usage.reasoning = next;
  });
}

function applyStopReason(state: UsageState, event: UsageEvent): void {
  const transformations = event.input_transformations;
  if (Array.isArray(transformations)) state.inputTransformations = transformations;
  if (event.delta.stop_reason === null) return;
  state.output.rawStopReason = event.delta.stop_reason;
  const stopReasonResult = mapStopReason({
    reason: event.delta.stop_reason,
    stopDetails: event.delta.stop_details,
  });
  state.output.stopReason = stopReasonResult.stopReason;
  if (stopReasonResult.errorMessage !== undefined && stopReasonResult.errorMessage !== "") {
    state.output.errorMessage = stopReasonResult.errorMessage;
  }
}

interface MessageDeltaInput {
  readonly state: UsageState;
  readonly event: UsageEvent;
}

function applyMessageDelta(input: MessageDeltaInput): void {
  const { state, event } = input;
  applyStopReason(state, event);
  applyUsage(state.output.usage, event);
  const usage = state.output.usage;
  usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  calculateCost(state.usageModel, usage);
}

interface ResolveUsageModelInput {
  readonly model: Model<"anthropic-messages">;
  readonly responseModel: string;
}

function resolveUsageModel(input: ResolveUsageModelInput): Model<"anthropic-messages"> {
  const { model, responseModel } = input;
  if (responseModel === model.id) return model;
  const fallbackCost = model.compat?.allowedFallbackModels?.find(
    (fallback) => fallback.provider === model.provider && fallback.model === responseModel,
  )?.cost;
  return fallbackCost === undefined ? model : { ...model, id: responseModel, cost: fallbackCost };
}

export { applyMessageDelta, resolveUsageModel, type UsageState };
