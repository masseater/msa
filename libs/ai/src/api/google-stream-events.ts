import type { Candidate, FunctionCall, GenerateContentResponse, Part } from "@google/genai";

import type typesModule from "../types.types.ts";
import errorBody from "../utils/error-body.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import jsonCodec from "../utils/json-codec.ts";
import googleMessages from "./google-messages.ts";
import googleShared from "./google-shared.ts";
import googleStreamEventsKit from "./google-stream-events-kit.ts";
import type googleStreamEventsTypes from "./google-stream-events.types.ts";
import type googleThinkingTypes from "./google-thinking.types.ts";

const { clock, models: modelsModule } = googleStreamEventsKit;

const { currentTimeMillis } = clock;
const { isThinkingPart, retainThoughtSignature } = googleMessages;
const { encodeJsonSync } = jsonCodec;
const { mapStopReason } = googleShared;
const { calculateCost } = modelsModule;
const { formatProviderError, normalizeProviderError, recordErrorStatus } = errorBody;

let toolCallCounter = 0;

const createGoogleStreamState = <T extends googleThinkingTypes.GoogleApiType>({
  model,
  events,
}: {
  readonly model: typesModule.Model<T>;
  readonly events: eventStreamTypes.AssistantMessageEventStream;
}): googleStreamEventsTypes.GoogleStreamState<T> => ({
  currentBlock: null,
  events,
  model,
  output: {
    api: model.api as typesModule.Api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "pending",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  },
});

const lastIndex = (
  state: googleStreamEventsTypes.GoogleStreamState<googleThinkingTypes.GoogleApiType>,
): number => state.output.content.length - 1;

function closeCurrentBlock<T extends googleThinkingTypes.GoogleApiType>(
  state: googleStreamEventsTypes.GoogleStreamState<T>,
): void {
  const block = state.currentBlock;
  if (block === null) return;
  const contentIndex = lastIndex(state);
  if (block.type === "text") {
    state.events.push({
      content: block.text,
      contentIndex,
      partial: state.output,
      type: "text_end",
    });
  } else {
    state.events.push({
      content: block.thinking,
      contentIndex,
      partial: state.output,
      type: "thinking_end",
    });
  }
  state.currentBlock = null;
}

function openBlock<T extends googleThinkingTypes.GoogleApiType>(
  state: googleStreamEventsTypes.GoogleStreamState<T>,
  isThinking: boolean,
): typesModule.TextContent | typesModule.ThinkingContent {
  closeCurrentBlock(state);
  const block: typesModule.TextContent | typesModule.ThinkingContent = isThinking
    ? { thinking: "", thinkingSignature: undefined, type: "thinking" }
    : { text: "", type: "text" };
  state.currentBlock = block;
  state.output.content.push(block);
  state.events.push({
    contentIndex: lastIndex(state),
    partial: state.output,
    type: isThinking ? "thinking_start" : "text_start",
  });
  return block;
}

function appendText<T extends googleThinkingTypes.GoogleApiType>(
  state: googleStreamEventsTypes.GoogleStreamState<T>,
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
    state.events.push({ contentIndex, delta, partial: state.output, type: "thinking_delta" });
  } else {
    block.text += delta;
    block.textSignature = retainThoughtSignature(block.textSignature, part.thoughtSignature);
    state.events.push({ contentIndex, delta, partial: state.output, type: "text_delta" });
  }
}

function toolCallId<T extends googleThinkingTypes.GoogleApiType>(
  state: googleStreamEventsTypes.GoogleStreamState<T>,
  call: FunctionCall,
): string {
  const providedId = call.id;
  const needsNewId =
    providedId === undefined ||
    providedId === "" ||
    state.output.content.some((block) => block.type === "toolCall" && block.id === providedId);
  return needsNewId ? `${call.name}_${currentTimeMillis()}_${++toolCallCounter}` : providedId;
}

function appendFunctionCall<T extends googleThinkingTypes.GoogleApiType>(
  state: googleStreamEventsTypes.GoogleStreamState<T>,
  part: Part,
  call: FunctionCall,
): void {
  closeCurrentBlock(state);
  const toolCall: typesModule.ToolCall = {
    arguments: (call.args as Record<string, any>) ?? {},
    id: toolCallId(state, call),
    name: call.name || "",
    type: "toolCall",
    ...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
  };
  state.output.content.push(toolCall);
  const contentIndex = lastIndex(state);
  const partial = state.output;
  const delta = encodeJsonSync(toolCall.arguments);
  for (const event of [
    { contentIndex, partial, type: "toolcall_start" },
    { contentIndex, delta, partial, type: "toolcall_delta" },
    { contentIndex, partial, toolCall, type: "toolcall_end" },
  ] as const) {
    state.events.push(event);
  }
}

function applyFinishReason(output: typesModule.AssistantMessage, candidate: Candidate): void {
  if (candidate.finishReason === undefined) return;
  output.rawStopReason = candidate.finishReason;
  output.stopReason = mapStopReason(candidate.finishReason);
  if (output.content.some((block) => block.type === "toolCall") && output.stopReason === "stop") {
    output.stopReason = "toolUse";
  }
}

function usageFrom(
  metadata: NonNullable<GenerateContentResponse["usageMetadata"]>,
): typesModule.Usage {
  const cached = metadata.cachedContentTokenCount || 0;
  const thoughts = metadata.thoughtsTokenCount || 0;
  return {
    cacheRead: cached,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: (metadata.promptTokenCount || 0) - cached,
    output: (metadata.candidatesTokenCount || 0) + thoughts,
    reasoning: thoughts,
    totalTokens: metadata.totalTokenCount || 0,
  };
}

const googleChunkHandler =
  <T extends googleThinkingTypes.GoogleApiType>(
    state: googleStreamEventsTypes.GoogleStreamState<T>,
  ) =>
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

function failGoogleStream<T extends googleThinkingTypes.GoogleApiType>({
  state,
  error,
  signal,
}: googleStreamEventsTypes.GoogleStreamFailure<T>): void {
  const { output, events } = state;
  for (const block of output.content) {
    if ("index" in block) delete (block as { index?: number }).index;
  }
  output.stopReason = signal?.aborted === true ? "aborted" : "error";
  const failure = normalizeProviderError(error);
  output.errorMessage = formatProviderError(failure);
  recordErrorStatus(output, failure);
  events.push({ error: output, reason: output.stopReason, type: "error" });
  events.end();
}

const googleStreamEvents = {
  closeCurrentBlock,
  createGoogleStreamState,
  failGoogleStream,
  googleChunkHandler,
};

export default googleStreamEvents;
