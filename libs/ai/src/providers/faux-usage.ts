import type typesModule from "../types.types.ts";
import textModule from "../utils/text.ts";
import type fauxUsageTypes from "./faux-usage.types.ts";

const { getSystemMessageText } = textModule;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function contentToText(
  content: string | Array<typesModule.TextContent | typesModule.ImageContent>,
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      return `[image:${block.mimeType}:${block.data.length}]`;
    })
    .join("\n");
}

function assistantContentToText(
  content: Array<typesModule.TextContent | typesModule.ThinkingContent | typesModule.ToolCall>,
): string {
  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "thinking") {
        return block.thinking;
      }
      return `${block.name}:${JSON.stringify(block.arguments)}`;
    })
    .join("\n");
}

function toolResultToText(message: typesModule.ToolResultMessage): string {
  return [message.toolName, ...message.content.map((block) => contentToText([block]))].join("\n");
}

function messageToText(message: typesModule.Message): string {
  if (message.role === "system") {
    return [
      getSystemMessageText(message),
      ...(message.toolsRemoved?.map((tool) => `tool-:${JSON.stringify(tool)}`) ?? []),
      ...(message.toolsAdded?.map((tool) => `tool+:${JSON.stringify(tool)}`) ?? []),
    ]
      .filter((part) => part.length > 0)
      .join("\n");
  }
  if (message.role === "user") {
    return contentToText(message.content);
  }
  if (message.role === "assistant") {
    return assistantContentToText(message.content);
  }
  return toolResultToText(message);
}

function joinedLength(messages: readonly string[], count = messages.length): number {
  let length = count > 0 ? (count - 1) * 2 : 0;
  for (let index = 0; index < count; index++) length += messages[index]!.length;
  return length;
}

function commonPromptPrefixLength(previous: readonly string[], current: readonly string[]): number {
  let index = 0;
  while (index < previous.length && index < current.length && previous[index] === current[index])
    index++;
  const rest = (messages: readonly string[]) =>
    index === messages.length ? "" : (index > 0 ? "\n\n" : "") + messages.slice(index).join("\n\n");
  return joinedLength(previous, index) + commonPrefixLength(rest(previous), rest(current));
}

function commonPrefixLength(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let index = 0;
  while (index < length && a[index] === b[index]) {
    index++;
  }
  return index;
}

function withUsageEstimate({
  message,
  context,
  options,
  promptCache,
}: fauxUsageTypes.UsageEstimateRequest): typesModule.AssistantMessage {
  const prompt = context.messages.map((entry) => `${entry.role}:${messageToText(entry)}`);
  const promptLength = joinedLength(prompt);
  const promptTokens = Math.ceil(promptLength / 4);
  const outputTokens = estimateTokens(assistantContentToText(message.content));
  let input = promptTokens;
  let cacheRead = 0;
  let cacheWrite = 0;
  const sessionId = options?.sessionId;

  if (sessionId !== undefined && sessionId !== "" && options?.cacheRetention !== "none") {
    const previousPrompt = promptCache.get(sessionId);
    if (previousPrompt === undefined) {
      cacheWrite = promptTokens;
    } else {
      const cachedChars = commonPromptPrefixLength(previousPrompt, prompt);
      cacheRead = Math.ceil(cachedChars / 4);
      cacheWrite = Math.ceil((promptLength - cachedChars) / 4);
      input = Math.max(0, promptTokens - cacheRead);
    }
    promptCache.set(sessionId, prompt);
  }

  return {
    ...message,
    usage: {
      cacheRead,
      cacheWrite,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input,
      output: outputTokens,
      totalTokens: input + outputTokens + cacheRead + cacheWrite,
    },
  };
}

const fauxUsage = {
  estimateTokens,
  withUsageEstimate,
};

export default fauxUsage;
