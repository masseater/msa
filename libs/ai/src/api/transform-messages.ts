import { Function } from "effect";

import type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from "../types.ts";
import { currentTimeMillis } from "../utils/clock.ts";

const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";

function replaceImagesWithPlaceholder(
  content: (TextContent | ImageContent)[],
  placeholder: string,
): TextContent[] {
  const result: TextContent[] = [];
  let previousWasPlaceholder = false;

  for (const block of content) {
    if (block.type === "image") {
      if (!previousWasPlaceholder) {
        result.push({ type: "text", text: placeholder });
      }
      previousWasPlaceholder = true;
      continue;
    }

    result.push(block);
    previousWasPlaceholder = block.text === placeholder;
  }

  return result;
}

function downgradeUnsupportedImages<TApi extends Api>(
  messages: Message[],
  model: Model<TApi>,
): Message[] {
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

type ToolCallIdNormalizer<TApi extends Api> = (
  id: string,
  model: Model<TApi>,
  source: AssistantMessage,
) => string;

interface ReplayContext<TApi extends Api> {
  readonly model: Model<TApi>;
  readonly normalizeToolCallId: ToolCallIdNormalizer<TApi> | undefined;
  readonly toolCallIdMap: Map<string, string>;
}

type AssistantBlock = AssistantMessage["content"][number];
type ThinkingBlock = Extract<AssistantBlock, { type: "thinking" }>;

function replayThinking(block: ThinkingBlock, isSameModel: boolean): AssistantBlock[] {
  if (block.redacted === true) return isSameModel ? [block] : [];
  if (isSameModel && block.thinkingSignature !== undefined && block.thinkingSignature !== "") {
    return [block];
  }
  if (block.thinking.trim() === "") return [];
  return isSameModel ? [block] : [{ type: "text", text: block.thinking }];
}

function replayToolCall<TApi extends Api>(
  toolCall: ToolCall,
  source: AssistantMessage,
  context: ReplayContext<TApi>,
): ToolCall {
  let normalizedToolCall: ToolCall = toolCall;
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

function replayAssistant<TApi extends Api>(
  message: AssistantMessage,
  context: ReplayContext<TApi>,
): AssistantMessage {
  const { model } = context;
  const isSameModel =
    message.provider === model.provider && message.api === model.api && message.model === model.id;
  const content = message.content.flatMap((block): AssistantBlock[] => {
    if (block.type === "thinking") return replayThinking(block, isSameModel);
    if (isSameModel) return [block];
    if (block.type === "text") return [{ type: "text", text: block.text }];
    if (block.type === "toolCall") return [replayToolCall(block, message, context)];
    return [block];
  });
  return Object.assign({}, message, { content });
}

function replayMessage<TApi extends Api>(message: Message, context: ReplayContext<TApi>): Message {
  if (message.role === "assistant") return replayAssistant(message, context);
  if (message.role !== "toolResult") return message;
  const normalizedId = context.toolCallIdMap.get(message.toolCallId);
  if (normalizedId === undefined || normalizedId === "" || normalizedId === message.toolCallId) {
    return message;
  }
  return Object.assign({}, message, { toolCallId: normalizedId });
}

function missingToolResult(toolCall: ToolCall): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text: "No result provided" }],
    isError: true,
    timestamp: currentTimeMillis(),
  };
}

function pairToolResults(messages: readonly Message[]): Message[] {
  const result: Message[] = [];
  let pendingToolCalls: ToolCall[] = [];
  const answered = new Set<string>();
  const heldSystemMessages: Message[] = [];
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

export const transformMessages: {
  <TApi extends Api>(
    model: Model<TApi>,
    normalizeToolCallId?: ToolCallIdNormalizer<TApi>,
  ): (messages: Message[]) => Message[];
  <TApi extends Api>(
    messages: Message[],
    model: Model<TApi>,
    normalizeToolCallId?: ToolCallIdNormalizer<TApi>,
  ): Message[];
} = Function.dual(
  (args) => Array.isArray(args[0]),
  function <TApi extends Api>(
    messages: Message[],
    model: Model<TApi>,
    normalizeToolCallId?: ToolCallIdNormalizer<TApi>,
  ): Message[] {
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
