import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages.js";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import { fromClaudeCodeName, mapStopReason } from "./convert.ts";

const { calculateCost } = ai;

type Block = (
  | aiTypes.ThinkingContent
  | { type: "text"; text: string }
  | (aiTypes.ToolCall & { partialJson: string })
) & {
  index: number;
};

const startBlock = (
  stream: aiTypes.AssistantMessageEventStream,
  output: aiTypes.AssistantMessage,
  event: Extract<RawMessageStreamEvent, { type: "content_block_start" }>,
  isOAuth: boolean,
  tools: aiTypes.Tool[],
): void => {
  const block = event.content_block;
  const index = event.index;

  if (block.type === "text") {
    output.content.push({ index, text: "", type: "text" } as never);
    stream.push({ contentIndex: output.content.length - 1, partial: output, type: "text_start" });
    return;
  }
  if (block.type === "thinking") {
    output.content.push({ index, thinking: "", thinkingSignature: "", type: "thinking" } as never);
    stream.push({
      contentIndex: output.content.length - 1,
      partial: output,
      type: "thinking_start",
    });
    return;
  }
  if (block.type === "tool_use") {
    output.content.push({
      arguments: {},
      id: block.id,
      index,
      name: isOAuth ? fromClaudeCodeName({ name: block.name, tools }) : block.name,
      partialJson: "",
      type: "toolCall",
    } as never);
    stream.push({
      contentIndex: output.content.length - 1,
      partial: output,
      type: "toolcall_start",
    });
  }
};

const deltaBlock = (
  stream: aiTypes.AssistantMessageEventStream,
  output: aiTypes.AssistantMessage,
  blocks: Block[],
  event: Extract<RawMessageStreamEvent, { type: "content_block_delta" }>,
): void => {
  const index = blocks.findIndex((b) => b.index === event.index);
  const block = blocks[index];
  if (block === undefined) return;

  const delta = event.delta;
  if (delta.type === "text_delta" && block.type === "text") {
    block.text += delta.text;
    stream.push({ contentIndex: index, delta: delta.text, partial: output, type: "text_delta" });
    return;
  }
  if (delta.type === "thinking_delta" && block.type === "thinking") {
    block.thinking += delta.thinking;
    stream.push({
      contentIndex: index,
      delta: delta.thinking,
      partial: output,
      type: "thinking_delta",
    });
    return;
  }
  if (delta.type === "input_json_delta" && block.type === "toolCall") {
    block.partialJson += delta.partial_json;
    try {
      block.arguments = JSON.parse(block.partialJson);
    } catch {
      block.arguments = {};
    }
    stream.push({
      contentIndex: index,
      delta: delta.partial_json,
      partial: output,
      type: "toolcall_delta",
    });
    return;
  }
  if (delta.type === "signature_delta" && block.type === "thinking") {
    block.thinkingSignature = (block.thinkingSignature || "") + delta.signature;
  }
};

const stopBlock = (
  stream: aiTypes.AssistantMessageEventStream,
  output: aiTypes.AssistantMessage,
  blocks: Block[],
  event: Extract<RawMessageStreamEvent, { type: "content_block_stop" }>,
): void => {
  const index = blocks.findIndex((b) => b.index === event.index);
  const block = blocks[index];
  if (block === undefined) return;

  if (block.type === "text") {
    stream.push({ content: block.text, contentIndex: index, partial: output, type: "text_end" });
    return;
  }
  if (block.type === "thinking") {
    stream.push({
      content: block.thinking,
      contentIndex: index,
      partial: output,
      type: "thinking_end",
    });
    return;
  }
  if (block.type === "toolCall") {
    try {
      block.arguments = JSON.parse(block.partialJson);
    } catch {
      block.arguments = {};
    }
    const toolCall = { ...block } as aiTypes.ToolCall;
    stream.push({ contentIndex: index, partial: output, toolCall, type: "toolcall_end" });
  }
};

const updateUsage = (
  model: aiTypes.Model<aiTypes.Api>,
  output: aiTypes.AssistantMessage,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
): void => {
  output.usage.input = usage.input_tokens ?? 0;
  output.usage.output = usage.output_tokens ?? 0;
  output.usage.cacheRead = usage.cache_read_input_tokens ?? 0;
  output.usage.cacheWrite = usage.cache_creation_input_tokens ?? 0;
  output.usage.totalTokens =
    output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
  calculateCost(model, output.usage);
};

export const handleEvent = (request: {
  readonly stream: aiTypes.AssistantMessageEventStream;
  readonly output: aiTypes.AssistantMessage;
  readonly model: aiTypes.Model<aiTypes.Api>;
  readonly tools: aiTypes.Tool[];
  readonly isOAuth: boolean;
  readonly event: RawMessageStreamEvent;
}): void => {
  const { stream, output, model, tools, isOAuth, event } = request;
  const blocks = output.content as Block[];

  switch (event.type) {
    case "message_start":
      updateUsage(model, output, event.message.usage);
      return;
    case "content_block_start":
      startBlock(stream, output, event, isOAuth, tools);
      return;
    case "content_block_delta":
      deltaBlock(stream, output, blocks, event);
      return;
    case "content_block_stop":
      stopBlock(stream, output, blocks, event);
      return;
    case "message_delta":
      if (event.delta.stop_reason !== null) {
        output.stopReason = mapStopReason(event.delta.stop_reason);
      }
      updateUsage(model, output, event.usage);
  }
};
