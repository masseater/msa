import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions.js";

import type { CacheRetention } from "../types.ts";
import type {
  ChatCompletionInstructionMessageParam,
  ChatCompletionTextPartWithCacheControl,
  ChatCompletionToolWithCacheControl,
  OpenAICompatCacheControl,
  ResolvedOpenAICompletionsCompat,
} from "./openai-completions-types.ts";

function getCompatCacheControl(input: {
  compat: ResolvedOpenAICompletionsCompat;
  cacheRetention: CacheRetention;
}): OpenAICompatCacheControl | undefined {
  const { compat, cacheRetention } = input;
  if (compat.cacheControlFormat !== "anthropic" || cacheRetention === "none") {
    return undefined;
  }

  const ttl = cacheRetention === "long" && compat.supportsLongCacheRetention ? "1h" : undefined;
  return { type: "ephemeral", ...(ttl === undefined ? {} : { ttl }) };
}

function addCacheControlToTextContent(
  message:
    | ChatCompletionInstructionMessageParam
    | ChatCompletionAssistantMessageParam
    | ChatCompletionToolMessageParam
    | Extract<ChatCompletionMessageParam, { role: "user" }>,
  cacheControl: OpenAICompatCacheControl,
): boolean {
  const content = message.content;
  if (typeof content === "string") {
    if (content.length === 0) {
      return false;
    }
    message.content = [
      {
        type: "text",
        text: content,
        cache_control: cacheControl,
      },
    ] as ChatCompletionTextPartWithCacheControl[];
    return true;
  }

  if (!Array.isArray(content)) {
    return false;
  }

  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (part?.type === "text") {
      const textPart = part as ChatCompletionTextPartWithCacheControl;
      textPart.cache_control = cacheControl;
      return true;
    }
  }

  return false;
}

function addCacheControlToInstructionMessage(
  message: ChatCompletionInstructionMessageParam,
  cacheControl: OpenAICompatCacheControl,
): boolean {
  return addCacheControlToTextContent(message, cacheControl);
}

function addCacheControlToMessage(
  message: ChatCompletionMessageParam,
  cacheControl: OpenAICompatCacheControl,
): boolean {
  if (message.role === "user" || message.role === "assistant" || message.role === "tool") {
    return addCacheControlToTextContent(message, cacheControl);
  }
  return false;
}

function addCacheControlToSystemPrompt(
  messages: ChatCompletionMessageParam[],
  cacheControl: OpenAICompatCacheControl,
): void {
  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      addCacheControlToInstructionMessage(message, cacheControl);
      return;
    }
  }
}

function addCacheControlToLastConversationMessage(
  messages: ChatCompletionMessageParam[],
  cacheControl: OpenAICompatCacheControl,
): void {
  for (const message of messages.toReversed()) {
    if (message.role === "user" || message.role === "assistant" || message.role === "tool") {
      if (addCacheControlToMessage(message, cacheControl)) {
        return;
      }
    }
  }
}

function addCacheControlToLastTool(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
  cacheControl: OpenAICompatCacheControl,
): void {
  if (tools === undefined || tools.length === 0) {
    return;
  }

  const lastTool = tools.at(-1) as ChatCompletionToolWithCacheControl;
  lastTool.cache_control = cacheControl;
}

interface ApplyCacheControlInput {
  readonly messages: ChatCompletionMessageParam[];
  readonly tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
  readonly cacheControl: OpenAICompatCacheControl;
}

function applyAnthropicCacheControl(input: ApplyCacheControlInput): void {
  const { messages, tools, cacheControl } = input;
  addCacheControlToSystemPrompt(messages, cacheControl);
  addCacheControlToLastTool(tools, cacheControl);
  addCacheControlToLastConversationMessage(messages, cacheControl);
}

export { applyAnthropicCacheControl, getCompatCacheControl };
