import type {
  BetaInputTransformation,
  BetaRawMessageStreamEvent as RawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import { calculateCost } from "../models.ts";
import type { AssistantMessage, Model, TextContent, ThinkingContent, ToolCall } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { parseStreamingJson, parseToolCallArguments } from "../utils/json-parse.ts";
import { applyMessageDelta, resolveUsageModel } from "./anthropic-messages-usage.ts";

type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & {
  index: number;
};

interface StreamState {
  readonly events: AssistantMessageEventStream;
  readonly model: Model<"anthropic-messages">;
  readonly output: AssistantMessage;
  usageModel: Model<"anthropic-messages">;
  inputTransformations: BetaInputTransformation[] | undefined;
}

function blocksOf(state: StreamState): Block[] {
  return state.output.content as Block[];
}

function findBlockEntry(
  state: StreamState,
  index: number,
): { block: Block; contentIndex: number } | undefined {
  const blocks = blocksOf(state);
  const contentIndex = blocks.findIndex((b) => b.index === index);
  const block = blocks[contentIndex];
  return block === undefined ? undefined : { block, contentIndex };
}

function handleMessageStart(
  state: StreamState,
  event: Extract<RawMessageStreamEvent, { type: "message_start" }>,
): void {
  const output = state.output;
  const usage = event.message.usage;
  output.responseId = event.message.id;
  const transformations = event.message.input_transformations;
  if (Array.isArray(transformations)) state.inputTransformations = transformations;
  const responseModel = event.message.model;
  if (responseModel !== state.model.id) output.responseModel = responseModel;
  state.usageModel = resolveUsageModel({ model: state.model, responseModel });
  output.usage.input = usage.input_tokens || 0;
  output.usage.output = usage.output_tokens || 0;
  output.usage.cacheRead = usage.cache_read_input_tokens || 0;
  output.usage.cacheWrite = usage.cache_creation_input_tokens || 0;
  output.usage.cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens || 0;
  output.usage.totalTokens =
    output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
  calculateCost(state.usageModel, output.usage);
}

function startTextBlock(state: StreamState, block: { text?: string | null }, index: number): void {
  const content: Block = { type: "text", text: block.text ?? "", index };
  state.output.content.push(content);
  state.events.push({
    type: "text_start",
    contentIndex: state.output.content.length - 1,
    partial: state.output,
  });
}

function startThinkingBlock(
  state: StreamState,
  block: { thinking?: string | null; signature?: string | null },
  index: number,
): void {
  const content: Block = {
    type: "thinking",
    thinking: block.thinking ?? "",
    thinkingSignature: block.signature ?? "",
    index,
  };
  state.output.content.push(content);
  state.events.push({
    type: "thinking_start",
    contentIndex: state.output.content.length - 1,
    partial: state.output,
  });
}

function startRedactedThinkingBlock(state: StreamState, data: string, index: number): void {
  const content: Block = {
    type: "thinking",
    thinking: "[Reasoning redacted]",
    thinkingSignature: data,
    redacted: true,
    index,
  };
  state.output.content.push(content);
  state.events.push({
    type: "thinking_start",
    contentIndex: state.output.content.length - 1,
    partial: state.output,
  });
}

function startToolUseBlock(
  state: StreamState,
  block: { id: string; name: string; input: unknown },
  index: number,
): void {
  const content: Block = {
    type: "toolCall",
    id: block.id,
    name: block.name,
    arguments: (block.input as Record<string, any>) ?? {},
    partialJson: "",
    index,
  };
  state.output.content.push(content);
  state.events.push({
    type: "toolcall_start",
    contentIndex: state.output.content.length - 1,
    partial: state.output,
  });
}

function handleContentBlockStart(
  state: StreamState,
  event: Extract<RawMessageStreamEvent, { type: "content_block_start" }>,
): void {
  const block = event.content_block;
  if (block.type === "fallback") {
    if (state.output.content.length > 0) {
      throw new Error("Anthropic performed an unsupported mid-output model fallback");
    }
    return;
  }
  if (block.type === "text") return startTextBlock(state, block, event.index);
  if (block.type === "thinking") return startThinkingBlock(state, block, event.index);
  if (block.type === "redacted_thinking")
    return startRedactedThinkingBlock(state, block.data, event.index);
  if (block.type === "tool_use") return startToolUseBlock(state, block, event.index);
}

function applyTextDelta(state: StreamState, delta: string, index: number): void {
  const entry = findBlockEntry(state, index);
  if (entry?.block.type !== "text") return;
  entry.block.text += delta;
  state.events.push({
    type: "text_delta",
    contentIndex: entry.contentIndex,
    delta,
    partial: state.output,
  });
}

function applyThinkingDelta(state: StreamState, delta: string, index: number): void {
  const entry = findBlockEntry(state, index);
  if (entry?.block.type !== "thinking") return;
  entry.block.thinking += delta;
  state.events.push({
    type: "thinking_delta",
    contentIndex: entry.contentIndex,
    delta,
    partial: state.output,
  });
}

function applyInputJsonDelta(state: StreamState, delta: string, index: number): void {
  const entry = findBlockEntry(state, index);
  if (entry?.block.type !== "toolCall") return;
  entry.block.partialJson += delta;
  entry.block.arguments = parseStreamingJson(entry.block.partialJson);
  state.events.push({
    type: "toolcall_delta",
    contentIndex: entry.contentIndex,
    delta,
    partial: state.output,
  });
}

function applySignatureDelta(state: StreamState, delta: string, index: number): void {
  const entry = findBlockEntry(state, index);
  if (entry?.block.type !== "thinking") return;
  entry.block.thinkingSignature = (entry.block.thinkingSignature ?? "") + delta;
}

function handleContentBlockDelta(
  state: StreamState,
  event: Extract<RawMessageStreamEvent, { type: "content_block_delta" }>,
): void {
  if (event.delta.type === "text_delta")
    return applyTextDelta(state, event.delta.text, event.index);
  if (event.delta.type === "thinking_delta")
    return applyThinkingDelta(state, event.delta.thinking, event.index);
  if (event.delta.type === "input_json_delta")
    return applyInputJsonDelta(state, event.delta.partial_json, event.index);
  if (event.delta.type === "signature_delta")
    return applySignatureDelta(state, event.delta.signature, event.index);
}

function finishTextBlock(state: StreamState, block: Block, contentIndex: number): void {
  delete (block as any).index;
  if (block.type !== "text") return;
  state.events.push({
    type: "text_end",
    contentIndex,
    content: block.text,
    partial: state.output,
  });
}

function finishThinkingBlock(state: StreamState, block: Block, contentIndex: number): void {
  delete (block as any).index;
  if (block.type !== "thinking") return;
  state.events.push({
    type: "thinking_end",
    contentIndex,
    content: block.thinking,
    partial: state.output,
  });
}

function finishToolCallBlock(state: StreamState, block: Block, contentIndex: number): void {
  delete (block as any).index;
  if (block.type !== "toolCall") return;
  Object.assign(block, parseToolCallArguments(block.partialJson));
  delete (block as { partialJson?: string }).partialJson;
  state.events.push({
    type: "toolcall_end",
    contentIndex,
    toolCall: block,
    partial: state.output,
  });
}

function handleContentBlockStop(
  state: StreamState,
  event: Extract<RawMessageStreamEvent, { type: "content_block_stop" }>,
): void {
  const entry = findBlockEntry(state, event.index);
  if (entry === undefined) return;
  const { block, contentIndex } = entry;
  if (block.type === "text") return finishTextBlock(state, block, contentIndex);
  if (block.type === "thinking") return finishThinkingBlock(state, block, contentIndex);
  if (block.type === "toolCall") return finishToolCallBlock(state, block, contentIndex);
}

interface DispatchEventInput {
  readonly state: StreamState;
  readonly event: RawMessageStreamEvent;
}

function dispatchEvent(input: DispatchEventInput): void {
  const { state, event } = input;
  if (event.type === "message_start") return handleMessageStart(state, event);
  if (event.type === "content_block_start") return handleContentBlockStart(state, event);
  if (event.type === "content_block_delta") return handleContentBlockDelta(state, event);
  if (event.type === "content_block_stop") return handleContentBlockStop(state, event);
  if (event.type === "message_delta") return applyMessageDelta({ state, event });
}

export { dispatchEvent, type StreamState };
