import type { Candidate, FunctionCall, GenerateContentResponse, Part } from "@google/genai";

import { calculateCost } from "../models.ts";
import type {
  Api,
  AssistantMessage,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "../types.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { encodeJsonSync } from "../utils/json-codec.ts";
import { isThinkingPart, retainThoughtSignature } from "./google-messages.ts";
import { mapStopReason } from "./google-shared.ts";
import type { GoogleApiType } from "./google-thinking.ts";

export interface GoogleStreamState<T extends GoogleApiType> {
  readonly model: Model<T>;
  readonly output: AssistantMessage;
  readonly events: AssistantMessageEventStream;
  currentBlock: TextContent | ThinkingContent | null;
}

let toolCallCounter = 0;

export const createGoogleStreamState = <T extends GoogleApiType>({
  model,
  events,
}: {
  readonly model: Model<T>;
  readonly events: AssistantMessageEventStream;
}): GoogleStreamState<T> => ({
  model,
  events,
  currentBlock: null,
  output: {
    role: "assistant",
    content: [],
    api: model.api as Api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: currentTimeMillis(),
  },
});

const lastIndex = (state: GoogleStreamState<GoogleApiType>): number =>
  state.output.content.length - 1;

export function closeCurrentBlock<T extends GoogleApiType>(state: GoogleStreamState<T>): void {
  const block = state.currentBlock;
  if (block === null) return;
  const contentIndex = lastIndex(state);
  if (block.type === "text") {
    state.events.push({
      type: "text_end",
      contentIndex,
      content: block.text,
      partial: state.output,
    });
  } else {
    state.events.push({
      type: "thinking_end",
      contentIndex,
      content: block.thinking,
      partial: state.output,
    });
  }
  state.currentBlock = null;
}

function openBlock<T extends GoogleApiType>(
  state: GoogleStreamState<T>,
  isThinking: boolean,
): TextContent | ThinkingContent {
  closeCurrentBlock(state);
  const block: TextContent | ThinkingContent = isThinking
    ? { type: "thinking", thinking: "", thinkingSignature: undefined }
    : { type: "text", text: "" };
  state.currentBlock = block;
  state.output.content.push(block);
  state.events.push({
    type: isThinking ? "thinking_start" : "text_start",
    contentIndex: lastIndex(state),
    partial: state.output,
  });
  return block;
}

function appendText<T extends GoogleApiType>(
  state: GoogleStreamState<T>,
  part: Part,
  delta: string,
): void {
  const isThinking = isThinkingPart(part);
  const current = state.currentBlock;
  const block =
    current !== null && (current.type === "thinking") === isThinking
      ? current
      : openBlock(state, isThinking);
  const contentIndex = lastIndex(state);
  if (block.type === "thinking") {
    block.thinking += delta;
    block.thinkingSignature = retainThoughtSignature(
      block.thinkingSignature,
      part.thoughtSignature,
    );
    state.events.push({ type: "thinking_delta", contentIndex, delta, partial: state.output });
  } else {
    block.text += delta;
    block.textSignature = retainThoughtSignature(block.textSignature, part.thoughtSignature);
    state.events.push({ type: "text_delta", contentIndex, delta, partial: state.output });
  }
}

function toolCallId<T extends GoogleApiType>(
  state: GoogleStreamState<T>,
  call: FunctionCall,
): string {
  const providedId = call.id;
  const needsNewId =
    providedId === undefined ||
    providedId === "" ||
    state.output.content.some((block) => block.type === "toolCall" && block.id === providedId);
  return needsNewId ? `${call.name}_${currentTimeMillis()}_${++toolCallCounter}` : providedId;
}

function appendFunctionCall<T extends GoogleApiType>(
  state: GoogleStreamState<T>,
  part: Part,
  call: FunctionCall,
): void {
  closeCurrentBlock(state);
  const toolCall: ToolCall = {
    type: "toolCall",
    id: toolCallId(state, call),
    name: call.name || "",
    arguments: (call.args as Record<string, any>) ?? {},
    ...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
  };
  state.output.content.push(toolCall);
  const contentIndex = lastIndex(state);
  const partial = state.output;
  state.events.push({ type: "toolcall_start", contentIndex, partial });
  state.events.push({
    type: "toolcall_delta",
    contentIndex,
    delta: encodeJsonSync(toolCall.arguments),
    partial,
  });
  state.events.push({ type: "toolcall_end", contentIndex, toolCall, partial });
}

function applyFinishReason(output: AssistantMessage, candidate: Candidate): void {
  if (candidate.finishReason === undefined) return;
  output.rawStopReason = candidate.finishReason;
  output.stopReason = mapStopReason(candidate.finishReason);
  if (output.content.some((block) => block.type === "toolCall") && output.stopReason === "stop") {
    output.stopReason = "toolUse";
  }
}

function usageFrom(metadata: NonNullable<GenerateContentResponse["usageMetadata"]>): Usage {
  const cached = metadata.cachedContentTokenCount || 0;
  const thoughts = metadata.thoughtsTokenCount || 0;
  return {
    input: (metadata.promptTokenCount || 0) - cached,
    output: (metadata.candidatesTokenCount || 0) + thoughts,
    cacheRead: cached,
    cacheWrite: 0,
    reasoning: thoughts,
    totalTokens: metadata.totalTokenCount || 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export const googleChunkHandler =
  <T extends GoogleApiType>(state: GoogleStreamState<T>) =>
  (chunk: GenerateContentResponse): void => {
    const { output } = state;
    output.responseId ||= chunk.responseId;
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.text !== undefined) appendText(state, part, part.text);
      if (part.functionCall !== undefined) appendFunctionCall(state, part, part.functionCall);
    }
    if (candidate !== undefined) applyFinishReason(output, candidate);
    if (chunk.usageMetadata !== undefined) {
      output.usage = usageFrom(chunk.usageMetadata);
      calculateCost(state.model, output.usage);
    }
  };

export interface GoogleStreamFailure<T extends GoogleApiType> {
  readonly state: GoogleStreamState<T>;
  readonly error: unknown;
  readonly signal: AbortSignal | undefined;
}

export function failGoogleStream<T extends GoogleApiType>({
  state,
  error,
  signal,
}: GoogleStreamFailure<T>): void {
  const { output, events } = state;
  for (const block of output.content) {
    if ("index" in block) delete (block as { index?: number }).index;
  }
  output.stopReason = signal?.aborted === true ? "aborted" : "error";
  output.errorMessage = formatProviderError(normalizeProviderError(error));
  events.push({ type: "error", reason: output.stopReason, error: output });
  events.end();
}
