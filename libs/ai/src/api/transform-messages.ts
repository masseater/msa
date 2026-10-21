import { Function } from "effect";

import type typesModule from "../types.types.ts";
import clock from "../utils/clock.ts";
import type transformMessagesTypes from "./transform-messages.types.ts";

const { currentTimeMillis } = clock;

const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";

function replaceImagesWithPlaceholder(
  content: (typesModule.TextContent | typesModule.ImageContent)[],
  placeholder: string,
): typesModule.TextContent[] {
  const result: typesModule.TextContent[] = [];
  let previousWasPlaceholder = false;

  for (const block of content) {
    if (block.type === "image") {
      if (!previousWasPlaceholder) {
        result.push({ text: placeholder, type: "text" });
      }
      previousWasPlaceholder = true;
      continue;
    }

    result.push(block);
    previousWasPlaceholder = block.text === placeholder;
  }

  return result;
}

function downgradeUnsupportedImages<TApi extends typesModule.Api>(
  messages: typesModule.Message[],
  model: typesModule.Model<TApi>,
): typesModule.Message[] {
  if (model.input.includes("image")) {
    return messages;
  }

  return messages.map((msg) => {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER),
      };
    }

    if (msg.role === "toolResult") {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER),
      };
    }

    return msg;
  });
}

interface ReplayContext<TApi extends typesModule.Api> {
  readonly model: typesModule.Model<TApi>;
  readonly normalizeToolCallId: transformMessagesTypes.ToolCallIdNormalizer<TApi> | undefined;
  readonly toolCallIdMap: Map<string, string>;
}

type AssistantBlock = typesModule.AssistantMessage["content"][number];
type ThinkingBlock = Extract<AssistantBlock, { type: "thinking" }>;

function replayThinking(block: ThinkingBlock, isSameModel: boolean): AssistantBlock[] {
  if (block.redacted === true) return isSameModel ? [block] : [];
  if (isSameModel && block.thinkingSignature !== undefined && block.thinkingSignature !== "") {
    return [block];
  }
  if (block.thinking.trim() === "") return [];
  return isSameModel ? [block] : [{ text: block.thinking, type: "text" }];
}

function replayToolCall<TApi extends typesModule.Api>(
  toolCall: typesModule.ToolCall,
  source: typesModule.AssistantMessage,
  context: ReplayContext<TApi>,
): typesModule.ToolCall {
  let normalizedToolCall: typesModule.ToolCall = toolCall;
  if (toolCall.thoughtSignature !== undefined && toolCall.thoughtSignature !== "") {
    normalizedToolCall = { ...toolCall };
    delete (normalizedToolCall as { thoughtSignature?: string }).thoughtSignature;
  }
  if (context.normalizeToolCallId === undefined) return normalizedToolCall;
  const normalizedId = context.normalizeToolCallId(toolCall.id, context.model, source);
  if (normalizedId === toolCall.id) return normalizedToolCall;
  context.toolCallIdMap.set(toolCall.id, normalizedId);
  return { ...normalizedToolCall, id: normalizedId };
}

function replayAssistant<TApi extends typesModule.Api>(
  message: typesModule.AssistantMessage,
  context: ReplayContext<TApi>,
): typesModule.AssistantMessage {
  const { model } = context;
  const isSameModel =
    message.provider === model.provider && message.api === model.api && message.model === model.id;
  const content = message.content.flatMap((block): AssistantBlock[] => {
    if (block.type === "thinking") return replayThinking(block, isSameModel);
    if (isSameModel) return [block];
    if (block.type === "text") return [{ text: block.text, type: "text" }];
    if (block.type === "toolCall") return [replayToolCall(block, message, context)];
    return [block];
  });
  return Object.assign({}, message, { content });
}

function replayMessage<TApi extends typesModule.Api>(
  message: typesModule.Message,
  context: ReplayContext<TApi>,
): typesModule.Message {
  if (message.role === "assistant") return replayAssistant(message, context);
  if (message.role !== "toolResult") return message;
  const normalizedId = context.toolCallIdMap.get(message.toolCallId);
  if (normalizedId === undefined || normalizedId === "" || normalizedId === message.toolCallId) {
    return message;
  }
  return Object.assign({}, message, { toolCallId: normalizedId });
}

function missingToolResult(toolCall: typesModule.ToolCall): typesModule.ToolResultMessage {
  return {
    content: [{ text: "No result provided", type: "text" }],
    isError: true,
    role: "toolResult",
    timestamp: currentTimeMillis(),
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  };
}

function pairToolResults(messages: readonly typesModule.Message[]): typesModule.Message[] {
  const result: typesModule.Message[] = [];
  let pendingToolCalls: typesModule.ToolCall[] = [];
  const answered = new Set<string>();
  const heldSystemMessages: typesModule.Message[] = [];
  const closePendingToolCalls = () => {
    for (const toolCall of pendingToolCalls) {
      if (!answered.has(toolCall.id)) result.push(missingToolResult(toolCall));
    }
    pendingToolCalls = [];
    answered.clear();
    result.push(...heldSystemMessages.splice(0));
  };

  for (const message of messages) {
    if (message.role === "assistant" || message.role === "user") closePendingToolCalls();
    if (message.role === "toolResult") answered.add(message.toolCallId);
    if (message.role === "system" && pendingToolCalls.length > 0) {
      heldSystemMessages.push(message);
      continue;
    }
    if (message.role === "assistant") {
      if (message.stopReason === "error" || message.stopReason === "aborted") continue;
      pendingToolCalls = message.content.filter((block) => block.type === "toolCall");
    }
    result.push(message);
  }
  closePendingToolCalls();
  return result;
}

const transformMessages: {
  <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    normalizeToolCallId?: transformMessagesTypes.ToolCallIdNormalizer<TApi>,
  ): (messages: typesModule.Message[]) => typesModule.Message[];
  <TApi extends typesModule.Api>(
    messages: typesModule.Message[],
    model: typesModule.Model<TApi>,
    normalizeToolCallId?: transformMessagesTypes.ToolCallIdNormalizer<TApi>,
  ): typesModule.Message[];
} = Function.dual(
  (args) => Array.isArray(args[0]),
  function <TApi extends typesModule.Api>(
    messages: typesModule.Message[],
    model: typesModule.Model<TApi>,
    normalizeToolCallId?: transformMessagesTypes.ToolCallIdNormalizer<TApi>,
  ): typesModule.Message[] {
    const normalizedMessages = messages.map((msg) =>
      msg.content === undefined || msg.content === null ? { ...msg, content: [] } : msg,
    );
    const context: ReplayContext<TApi> = {
      model,
      normalizeToolCallId,
      toolCallIdMap: new Map(),
    };
    return pairToolResults(
      downgradeUnsupportedImages(normalizedMessages, model).map((message) =>
        replayMessage(message, context),
      ),
    );
  },
);

const transformMessagesModule = {
  transformMessages,
};

export default transformMessagesModule;
