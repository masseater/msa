import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions.js";

import type typesModule from "../types.types.ts";
import type openaiCompletionsCacheTypes from "./openai-completions-cache.types.ts";
import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";

function getCompatCacheControl(input: {
  compat: openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat;
  cacheRetention: typesModule.CacheRetention;
}): openaiCompletionsTypesModule.OpenAICompatCacheControl | undefined {
  const { compat, cacheRetention } = input;
  if (compat.cacheControlFormat !== "anthropic" || cacheRetention === "none") {
    return undefined;
  }

  const ttl = cacheRetention === "long" && compat.supportsLongCacheRetention ? "1h" : undefined;
  return { type: "ephemeral", ...(ttl === undefined ? {} : { ttl }) };
}

function addCacheControlToTextContent(
  message:
    | openaiCompletionsTypesModule.ChatCompletionInstructionMessageParam
    | ChatCompletionAssistantMessageParam
    | ChatCompletionToolMessageParam
    | Extract<ChatCompletionMessageParam, { role: "user" }>,
  cacheControl: openaiCompletionsTypesModule.OpenAICompatCacheControl,
): boolean {
  const content = message.content;
  if (typeof content === "string") {
    if (content.length === 0) {
      return false;
    }
    message.content = [
      {
        cache_control: cacheControl,
        text: content,
        type: "text",
      },
    ] as openaiCompletionsTypesModule.ChatCompletionTextPartWithCacheControl[];
    return true;
  }

  if (!Array.isArray(content)) {
    return false;
  }

  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (part?.type === "text") {
      const textPart = part as openaiCompletionsTypesModule.ChatCompletionTextPartWithCacheControl;
      textPart.cache_control = cacheControl;
      return true;
    }
  }

  return false;
}

function addCacheControlToInstructionMessage(
  message: openaiCompletionsTypesModule.ChatCompletionInstructionMessageParam,
  cacheControl: openaiCompletionsTypesModule.OpenAICompatCacheControl,
): boolean {
  return addCacheControlToTextContent(message, cacheControl);
}

function addCacheControlToMessage(
  message: ChatCompletionMessageParam,
  cacheControl: openaiCompletionsTypesModule.OpenAICompatCacheControl,
): boolean {
  if (message.role === "user" || message.role === "assistant" || message.role === "tool") {
    return addCacheControlToTextContent(message, cacheControl);
  }
  return false;
}

function addCacheControlToSystemPrompt(
  messages: ChatCompletionMessageParam[],
  cacheControl: openaiCompletionsTypesModule.OpenAICompatCacheControl,
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
  cacheControl: openaiCompletionsTypesModule.OpenAICompatCacheControl,
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
  cacheControl: openaiCompletionsTypesModule.OpenAICompatCacheControl,
): void {
  if (tools === undefined || tools.length === 0) {
    return;
  }

  const lastTool = tools.at(-1) as openaiCompletionsTypesModule.ChatCompletionToolWithCacheControl;
  lastTool.cache_control = cacheControl;
}
function applyAnthropicCacheControl(
  input: openaiCompletionsCacheTypes.ApplyCacheControlInput,
): void {
  const { messages, tools, cacheControl } = input;
  addCacheControlToSystemPrompt(messages, cacheControl);
  addCacheControlToLastTool(tools, cacheControl);
  addCacheControlToLastConversationMessage(messages, cacheControl);
}

const openaiCompletionsCache = {
  applyAnthropicCacheControl,
  getCompatCacheControl,
};

export default openaiCompletionsCache;
