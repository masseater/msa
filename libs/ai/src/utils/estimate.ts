import type typesModule from "../types.types.ts";
import type estimateTypes from "./estimate.types.ts";
import textModule from "./text.ts";

const { getSystemMessageText } = textModule;

const CHARS_PER_TOKEN = 3.5;
const ESTIMATED_IMAGE_CHARS = 4800;

function calculateContextTokens(usage: typesModule.Usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function estimateTextAndImageContentChars(
  content: string | Array<typesModule.TextContent | typesModule.ImageContent>,
): number {
  if (typeof content === "string") return content.length;

  let chars = 0;
  for (const block of content)
    chars += block.type === "text" ? block.text.length : ESTIMATED_IMAGE_CHARS;
  return chars;
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateTextAndImageContentTokens(
  content: string | Array<typesModule.TextContent | typesModule.ImageContent>,
): number {
  return Math.ceil(estimateTextAndImageContentChars(content) / CHARS_PER_TOKEN);
}

function estimateMessageTokens(message: typesModule.Message): number {
  let chars = 0;

  if (message.role === "system") {
    return (
      estimateTextTokens(getSystemMessageText(message)) +
      estimateToolsTokens(message.toolsAdded) +
      estimateToolsTokens(message.toolsRemoved)
    );
  }
  if (message.role === "user") return estimateTextAndImageContentTokens(message.content);
  if (message.role === "toolResult") return estimateTextAndImageContentTokens(message.content);

  for (const block of message.content) {
    if (block.type === "text") {
      chars += block.text.length;
    } else if (block.type === "thinking") {
      chars += block.thinking.length;
    } else {
      chars += block.name.length + safeJsonStringify(block.arguments).length;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function getLastAssistantUsageInfo(
  messages: readonly typesModule.Message[],
): { usage: typesModule.Usage; index: number } | undefined {
  let latestPrefixTimestamp = Number.NEGATIVE_INFINITY;
  let usageInfo: { usage: typesModule.Usage; index: number } | undefined;

  for (const [i, message] of messages.entries()) {
    if (message.role === "assistant") {
      const assistant = message as typesModule.AssistantMessage;
      const usageAppliesToPrefix = assistant.timestamp >= latestPrefixTimestamp;
      if (
        usageAppliesToPrefix &&
        assistant.stopReason !== "aborted" &&
        assistant.stopReason !== "error" &&
        calculateContextTokens(assistant.usage) > 0
      ) {
        usageInfo = { index: i, usage: assistant.usage };
      }
    }
    latestPrefixTimestamp = Math.max(latestPrefixTimestamp, message.timestamp);
  }

  return usageInfo;
}

function estimateContextTokens(
  context: typesModule.TranscriptContext | readonly typesModule.Message[],
): estimateTypes.ContextUsageEstimate {
  const messages = "messages" in context ? context.messages : context;
  const usageInfo = getLastAssistantUsageInfo(messages);
  if (usageInfo !== undefined) {
    const usageTokens = calculateContextTokens(usageInfo.usage);
    let trailingTokens = 0;
    for (const message of messages.slice(usageInfo.index + 1)) {
      trailingTokens += estimateMessageTokens(message);
    }
    return {
      lastUsageIndex: usageInfo.index,
      tokens: usageTokens + trailingTokens,
      trailingTokens,
      usageTokens,
    };
  }

  let tokens = 0;
  for (const message of messages) tokens += estimateMessageTokens(message);
  return { lastUsageIndex: null, tokens, trailingTokens: tokens, usageTokens: 0 };
}

function estimateToolsTokens(tools: readonly unknown[] | undefined): number {
  if (tools === undefined || tools.length === 0) return 0;
  return estimateTextTokens(safeJsonStringify(tools));
}

const estimate = {
  calculateContextTokens,
  estimateContextTokens,
  estimateMessageTokens,
  estimateTextAndImageContentTokens,
  estimateTextTokens,
};

export default estimate;
