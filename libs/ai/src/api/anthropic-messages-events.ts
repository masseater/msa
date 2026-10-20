import type { BetaRawMessageStreamEvent as RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import modelsModule from "../models.ts";
import type typesModule from "../types.types.ts";
import jsonParse from "../utils/json-parse.ts";
import type anthropicMessagesEventsTypes from "./anthropic-messages-events.types.ts";
import anthropicMessagesUsage from "./anthropic-messages-usage.ts";

const { applyMessageDelta, resolveUsageModel } = anthropicMessagesUsage;
const { calculateCost } = modelsModule;
const { parseStreamingJson, parseToolCallArguments } = jsonParse;

type Block = (
  | typesModule.ThinkingContent
  | typesModule.TextContent
  | (typesModule.ToolCall & { partialJson: string })
) & {
  index: number;
};

function blocksOf(state: anthropicMessagesEventsTypes.StreamState): Block[] {
  return state.output.content as Block[];
}

function findBlockEntry(
  state: anthropicMessagesEventsTypes.StreamState,
  index: number,
): { block: Block; contentIndex: number } | undefined {
  const blocks = blocksOf(state);
  const contentIndex = blocks.findIndex((b) => b.index === index);
  const block = blocks[contentIndex];
  return block === undefined ? undefined : { block, contentIndex };
}

function handleMessageStart(
  state: anthropicMessagesEventsTypes.StreamState,
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

function startTextBlock(
  state: anthropicMessagesEventsTypes.StreamState,
  block: { text?: string | null },
  index: number,
): void {
  const content: Block = { index, text: block.text ?? "", type: "text" };
  state.output.content.push(content);
  state.events.push({
    contentIndex: state.output.content.length - 1,
    partial: state.output,
    type: "text_start",
  });
}

function startThinkingBlock(
  state: anthropicMessagesEventsTypes.StreamState,
  block: { thinking?: string | null; signature?: string | null },
  index: number,
): void {
  const content: Block = {
    index,
    thinking: block.thinking ?? "",
    thinkingSignature: block.signature ?? "",
    type: "thinking",
  };
  state.output.content.push(content);
  state.events.push({
    contentIndex: state.output.content.length - 1,
    partial: state.output,
    type: "thinking_start",
  });
}

function startRedactedThinkingBlock(
  state: anthropicMessagesEventsTypes.StreamState,
  data: string,
  index: number,
): void {
  const content: Block = {
    index,
    redacted: true,
    thinking: "[Reasoning redacted]",
    thinkingSignature: data,
    type: "thinking",
  };
  state.output.content.push(content);
  state.events.push({
    contentIndex: state.output.content.length - 1,
    partial: state.output,
    type: "thinking_start",
  });
}

function startToolUseBlock(
  state: anthropicMessagesEventsTypes.StreamState,
  block: { id: string; name: string; input: unknown },
  index: number,
): void {
  const content: Block = {
    arguments: (block.input as Record<string, any>) ?? {},
    id: block.id,
    index,
    name: block.name,
    partialJson: "",
    type: "toolCall",
  };
  state.output.content.push(content);
  state.events.push({
    contentIndex: state.output.content.length - 1,
    partial: state.output,
    type: "toolcall_start",
  });
}

function handleContentBlockStart(
  state: anthropicMessagesEventsTypes.StreamState,
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

function applyTextDelta(
  state: anthropicMessagesEventsTypes.StreamState,
  delta: string,
  index: number,
): void {
  const entry = findBlockEntry(state, index);
  if (entry?.block.type !== "text") return;
  entry.block.text += delta;
  state.events.push({
    contentIndex: entry.contentIndex,
    delta,
    partial: state.output,
    type: "text_delta",
  });
}

function applyThinkingDelta(
  state: anthropicMessagesEventsTypes.StreamState,
  delta: string,
  index: number,
): void {
  const entry = findBlockEntry(state, index);
  if (entry?.block.type !== "thinking") return;
  entry.block.thinking += delta;
  state.events.push({
    contentIndex: entry.contentIndex,
    delta,
    partial: state.output,
    type: "thinking_delta",
  });
}

function applyInputJsonDelta(
  state: anthropicMessagesEventsTypes.StreamState,
  delta: string,
  index: number,
): void {
  const entry = findBlockEntry(state, index);
  if (entry?.block.type !== "toolCall") return;
  entry.block.partialJson += delta;
  entry.block.arguments = parseStreamingJson(entry.block.partialJson);
  state.events.push({
    contentIndex: entry.contentIndex,
    delta,
    partial: state.output,
    type: "toolcall_delta",
  });
}

function applySignatureDelta(
  state: anthropicMessagesEventsTypes.StreamState,
  delta: string,
  index: number,
): void {
  const entry = findBlockEntry(state, index);
  if (entry?.block.type !== "thinking") return;
  entry.block.thinkingSignature = (entry.block.thinkingSignature ?? "") + delta;
}

function handleContentBlockDelta(
  state: anthropicMessagesEventsTypes.StreamState,
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

function finishTextBlock(
  state: anthropicMessagesEventsTypes.StreamState,
  block: Block,
  contentIndex: number,
): void {
  delete (block as any).index;
  if (block.type !== "text") return;
  state.events.push({
    content: block.text,
    contentIndex,
    partial: state.output,
    type: "text_end",
  });
}

function finishThinkingBlock(
  state: anthropicMessagesEventsTypes.StreamState,
  block: Block,
  contentIndex: number,
): void {
  delete (block as any).index;
  if (block.type !== "thinking") return;
  state.events.push({
    content: block.thinking,
    contentIndex,
    partial: state.output,
    type: "thinking_end",
  });
}

function finishToolCallBlock(
  state: anthropicMessagesEventsTypes.StreamState,
  block: Block,
  contentIndex: number,
): void {
  delete (block as any).index;
  if (block.type !== "toolCall") return;
  Object.assign(block, parseToolCallArguments(block.partialJson));
  delete (block as { partialJson?: string }).partialJson;
  state.events.push({
    contentIndex,
    partial: state.output,
    toolCall: block,
    type: "toolcall_end",
  });
}

function handleContentBlockStop(
  state: anthropicMessagesEventsTypes.StreamState,
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
  readonly state: anthropicMessagesEventsTypes.StreamState;
  readonly event: RawMessageStreamEvent;
}

function dispatchEvent(input: DispatchEventInput): void {
  const { state, event } = input;
  if (event.type === "message_start") return handleMessageStart(state, event);
  if (event.type === "content_block_start") return handleContentBlockStart(state, event);
  if (event.type === "content_block_delta") return handleContentBlockDelta(state, event);
  if (event.type === "content_block_stop") return handleContentBlockStop(state, event);
  if (event.type === "message_delta") return applyMessageDelta({ event, state });
}

const anthropicMessagesEvents = {
  dispatchEvent,
};

export default anthropicMessagesEvents;
