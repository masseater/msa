import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages.js";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  calculateCost,
  type Model,
  type ThinkingContent,
  type Tool,
  type ToolCall,
} from "@msa/ai";

import { fromClaudeCodeName, mapStopReason } from "./convert.ts";

type Block = (
  | ThinkingContent
  | { type: "text"; text: string }
  | (ToolCall & { partialJson: string })
) & {
  index: number;
};

const startBlock = (
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  event: Extract<RawMessageStreamEvent, { type: "content_block_start" }>,
  isOAuth: boolean,
  tools: Tool[],
): void => {
  const block = event.content_block;
  const index = event.index;

  if (block.type === "text") {
    output.content.push({ type: "text", text: "", index } as never);
    stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
    return;
  }
  if (block.type === "thinking") {
    output.content.push({ type: "thinking", thinking: "", thinkingSignature: "", index } as never);
    stream.push({
      type: "thinking_start",
      contentIndex: output.content.length - 1,
      partial: output,
    });
    return;
  }
  if (block.type === "tool_use") {
    output.content.push({
      type: "toolCall",
      id: block.id,
      name: isOAuth ? fromClaudeCodeName({ name: block.name, tools }) : block.name,
      arguments: {},
      partialJson: "",
      index,
    } as never);
    stream.push({
      type: "toolcall_start",
      contentIndex: output.content.length - 1,
      partial: output,
    });
  }
};

const deltaBlock = (
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  blocks: Block[],
  event: Extract<RawMessageStreamEvent, { type: "content_block_delta" }>,
): void => {
  const index = blocks.findIndex((b) => b.index === event.index);
  const block = blocks[index];
  if (block === undefined) return;

  const delta = event.delta;
  if (delta.type === "text_delta" && block.type === "text") {
    block.text += delta.text;
    stream.push({ type: "text_delta", contentIndex: index, delta: delta.text, partial: output });
    return;
  }
  if (delta.type === "thinking_delta" && block.type === "thinking") {
    block.thinking += delta.thinking;
    stream.push({
      type: "thinking_delta",
      contentIndex: index,
      delta: delta.thinking,
      partial: output,
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
      type: "toolcall_delta",
      contentIndex: index,
      delta: delta.partial_json,
      partial: output,
    });
    return;
  }
  if (delta.type === "signature_delta" && block.type === "thinking") {
    block.thinkingSignature = (block.thinkingSignature || "") + delta.signature;
  }
};

const stopBlock = (
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  blocks: Block[],
  event: Extract<RawMessageStreamEvent, { type: "content_block_stop" }>,
): void => {
  const index = blocks.findIndex((b) => b.index === event.index);
  const block = blocks[index];
  if (block === undefined) return;

  if (block.type === "text") {
    stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
    return;
  }
  if (block.type === "thinking") {
    stream.push({
      type: "thinking_end",
      contentIndex: index,
      content: block.thinking,
      partial: output,
    });
    return;
  }
  if (block.type === "toolCall") {
    try {
      block.arguments = JSON.parse(block.partialJson);
    } catch {
      block.arguments = {};
    }
    const toolCall = { ...block } as ToolCall;
    stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: output });
  }
};

const updateUsage = (
  model: Model<Api>,
  output: AssistantMessage,
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
  readonly stream: AssistantMessageEventStream;
  readonly output: AssistantMessage;
  readonly model: Model<Api>;
  readonly tools: Tool[];
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
