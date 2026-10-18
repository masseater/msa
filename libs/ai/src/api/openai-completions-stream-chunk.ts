import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";

import { parseStreamingJson } from "../utils/json-parse.ts";
import {
  appendOpenAIReasoningDetail,
  isOpenAIReasoningDetail,
} from "./openai-completions-reasoning.ts";
import {
  contentIndexOf,
  ensureTextBlock,
  ensureThinkingBlock,
} from "./openai-completions-stream-state.ts";
import {
  appendCustomToolCallInput,
  ensureToolCallBlock,
  getCustomToolCallInput,
} from "./openai-completions-stream-tool-calls.ts";
import type {
  CompletionsStreamState,
  StreamingToolCallDelta,
} from "./openai-completions-stream-types.ts";
import {
  mapStopReason,
  parseChunkUsage,
  type RawUsage,
} from "./openai-completions-stream-usage.ts";

const REASONING_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"] as const;

function findReasoningField(deltaFields: Record<string, unknown>): string | undefined {
  for (const field of REASONING_FIELDS) {
    const value = deltaFields[field];
    if (typeof value === "string" && value.length > 0) return field;
  }
  return undefined;
}

function applyReasoningDelta(
  state: CompletionsStreamState,
  deltaFields: Record<string, unknown>,
): void {
  const field = findReasoningField(deltaFields);
  if (field === undefined) return;
  const delta = deltaFields[field];
  if (typeof delta !== "string" || delta.length === 0) return;
  const thinkingSignature =
    state.model.provider === "opencode-go" && field === "reasoning" ? "reasoning_content" : field;
  const block = ensureThinkingBlock({ state, thinkingSignature });
  block.thinking += delta;
  state.events.push({
    type: "thinking_delta",
    contentIndex: contentIndexOf({ state, block }),
    delta,
    partial: state.output,
  });
}

function applyReasoningDetails(state: CompletionsStreamState, reasoningDetails: unknown): void {
  if (!Array.isArray(reasoningDetails)) return;
  for (const detail of reasoningDetails) {
    if (!isOpenAIReasoningDetail(detail)) continue;
    ensureThinkingBlock({ state, thinkingSignature: "" });
    state.streamedReasoningDetails ??= [];
    appendOpenAIReasoningDetail({
      details: state.streamedReasoningDetails,
      detail,
    });
  }
}

function applyContentDelta(
  state: CompletionsStreamState,
  content: string | null | undefined,
): void {
  if (content === null || content === undefined || content.length === 0) return;
  const block = ensureTextBlock(state);
  block.text += content;
  state.events.push({
    type: "text_delta",
    contentIndex: contentIndexOf({ state, block }),
    delta: content,
    partial: state.output,
  });
}

function applySingleToolCallDelta(
  state: CompletionsStreamState,
  toolCall: StreamingToolCallDelta,
): void {
  const block = ensureToolCallBlock({ state, toolCall });
  if (block.id === "" && toolCall.id !== undefined && toolCall.id !== "") {
    block.id = toolCall.id;
    state.toolCallBlocksById.set(toolCall.id, block);
  }
  const name = toolCall.function?.name ?? toolCall.custom?.name;
  if (block.name === "" && name !== undefined && name !== "") {
    block.name = name;
  }

  let delta = "";
  const functionArguments = toolCall.function?.arguments;
  const customInput = toolCall.custom?.input;
  if (functionArguments !== undefined && functionArguments !== "") {
    delta = functionArguments;
    block.partialArgs = (block.partialArgs ?? "") + functionArguments;
    block.arguments = parseStreamingJson(block.partialArgs);
  } else if (customInput !== undefined && customInput !== "") {
    const nextInput = getCustomToolCallInput({ block }) + customInput;
    delta = appendCustomToolCallInput({ block, nextInput, close: false }) ?? "";
  }
  state.events.push({
    type: "toolcall_delta",
    contentIndex: contentIndexOf({ state, block }),
    delta,
    partial: state.output,
  });
}

function applyToolCallDeltas(
  state: CompletionsStreamState,
  toolCalls: ReadonlyArray<StreamingToolCallDelta>,
): void {
  for (const toolCall of toolCalls) {
    applySingleToolCallDelta(state, toolCall);
  }
}

function applyFinishReason(
  state: CompletionsStreamState,
  finishReason: ChatCompletionChunk.Choice["finish_reason"],
): void {
  if (finishReason === null) return;
  state.output.rawStopReason = finishReason;
  const finishReasonResult = mapStopReason(finishReason);
  state.output.stopReason = finishReasonResult.stopReason;
  if (finishReasonResult.errorMessage !== undefined && finishReasonResult.errorMessage !== "") {
    state.output.errorMessage = finishReasonResult.errorMessage;
  }
  state.hasFinishReason = true;
}

function applyChunkUsage(state: CompletionsStreamState, chunk: ChatCompletionChunk): void {
  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
  if (chunk.usage !== undefined && chunk.usage !== null) {
    state.output.usage = parseChunkUsage({ rawUsage: chunk.usage, model: state.model });
    return;
  }
  const choiceUsage = (choice as { usage?: RawUsage } | undefined)?.usage;
  if (Boolean(choiceUsage) && choiceUsage !== undefined) {
    state.output.usage = parseChunkUsage({ rawUsage: choiceUsage, model: state.model });
  }
}

function applyChunkIdentity(state: CompletionsStreamState, chunk: ChatCompletionChunk): void {
  state.output.responseId ||= chunk.id;
  if (typeof chunk.model === "string" && chunk.model.length > 0 && chunk.model !== state.model.id) {
    state.output.responseModel ||= chunk.model;
  }
}

function processChunk(input: { state: CompletionsStreamState; chunk: unknown }): void {
  const { state, chunk } = input;
  if (typeof chunk !== "object" || chunk === null) return;
  const completionChunk = chunk as ChatCompletionChunk;
  applyChunkIdentity(state, completionChunk);
  applyChunkUsage(state, completionChunk);
  const choice = Array.isArray(completionChunk.choices) ? completionChunk.choices[0] : undefined;
  if (choice === undefined) return;
  applyFinishReason(state, choice.finish_reason);
  if (choice.delta === undefined || choice.delta === null) return;
  const deltaFields = choice.delta as Record<string, unknown>;
  applyReasoningDelta(state, deltaFields);
  applyReasoningDetails(state, deltaFields["reasoning_details"]);
  applyContentDelta(state, choice.delta.content);
  if (choice.delta.tool_calls !== undefined) {
    applyToolCallDeltas(state, choice.delta.tool_calls as StreamingToolCallDelta[]);
  }
}

export { processChunk };
