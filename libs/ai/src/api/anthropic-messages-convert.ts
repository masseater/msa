import type {
  BetaCacheControlEphemeral as CacheControlEphemeral,
  BetaContentBlockParam as ContentBlockParam,
  BetaMessageParam as MessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type typesModule from "../types.types.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";
import textModule from "../utils/text.ts";
import anthropicMessagesCompat from "./anthropic-messages-compat.ts";
import type anthropicMessagesCompatTypes from "./anthropic-messages-compat.types.ts";
import anthropicMessagesContent from "./anthropic-messages-content.ts";
import type anthropicMessagesConvertTypes from "./anthropic-messages-convert.types.ts";

const { convertContentBlocks } = anthropicMessagesContent;
const { renderSystemMessageUpdate } = textModule;
const { sanitizeSurrogates } = sanitizeUnicode;
const { isAnthropicEffort } = anthropicMessagesCompat;

function normalizeToolCallId(id: string): string {
  return id.replaceAll(/[^a-zA-Z0-9_-]/gu, (char) => "_".repeat(char.length)).slice(0, 64);
}

function convertToolResult(msg: typesModule.ToolResultMessage): ContentBlockParam {
  const content = msg.isError
    ? msg.content.map((block) =>
        block.type === "image"
          ? {
              text: "[image omitted: error tool results cannot contain images]",
              type: "text" as const,
            }
          : block,
      )
    : msg.content;
  return {
    content: convertContentBlocks(content),
    is_error: msg.isError,
    tool_use_id: msg.toolCallId,
    type: "tool_result",
  };
}

function convertSystemMessage(
  msg: Extract<typesModule.Message, { role: "system" }>,
  convertToolDefinitions: anthropicMessagesConvertTypes.ToolDefinitionsConverter | undefined,
): MessageParam | undefined {
  const text = renderSystemMessageUpdate(msg);
  const blocks: ContentBlockParam[] = [];
  if (text.length > 0) blocks.push({ text: sanitizeSurrogates(text), type: "text" });
  if (convertToolDefinitions !== undefined) {
    const added = msg.toolsAdded ?? [];
    const redefined = new Set(added.map((tool) => tool.name));
    for (const tool of msg.toolsRemoved ?? []) {
      if (redefined.has(tool.name)) continue;
      blocks.push({
        tool: {
          name: tool.name,
          type: "tool_reference",
        },
        type: "tool_removal",
      });
    }
    for (const definition of convertToolDefinitions(added)) {
      blocks.push({ tool: { definition, type: "tool_definition" }, type: "tool_addition" });
    }
  }
  return blocks.length > 0 ? { content: blocks, role: "system" } : undefined;
}

function convertUserMessage(
  msg: Extract<typesModule.Message, { role: "user" }>,
): MessageParam | undefined {
  if (typeof msg.content === "string") {
    if (msg.content.trim().length === 0) return undefined;
    return { content: sanitizeSurrogates(msg.content), role: "user" };
  }
  const blocks = msg.content.map((item): ContentBlockParam =>
    item.type === "text"
      ? { text: sanitizeSurrogates(item.text), type: "text" }
      : {
          source: {
            data: item.data,
            media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            type: "base64",
          },
          type: "image",
        },
  );
  const filteredBlocks = blocks.filter((b) =>
    b.type === "text" ? b.text.trim().length > 0 : true,
  );
  if (filteredBlocks.length === 0) return undefined;
  return { content: filteredBlocks, role: "user" };
}

function convertThinkingBlock(
  block: Extract<typesModule.Message, { role: "assistant" }>["content"][number] & {
    type: "thinking";
  },
  allowEmptySignature: boolean,
): ContentBlockParam | undefined {
  if (block.redacted === true) {
    return { data: block.thinkingSignature!, type: "redacted_thinking" };
  }
  const thinkingSignature = block.thinkingSignature;
  const hasThinkingSignature =
    thinkingSignature !== undefined &&
    thinkingSignature !== "" &&
    thinkingSignature.trim().length > 0;
  if (block.thinking.trim().length === 0 && !hasThinkingSignature) return undefined;
  if (hasThinkingSignature) {
    return {
      signature: thinkingSignature,
      thinking: sanitizeSurrogates(block.thinking),
      type: "thinking",
    };
  }
  return allowEmptySignature
    ? { signature: "", thinking: sanitizeSurrogates(block.thinking), type: "thinking" }
    : { text: sanitizeSurrogates(block.thinking), type: "text" };
}

function convertAssistantBlocks(
  msg: Extract<typesModule.Message, { role: "assistant" }>,
  allowEmptySignature: boolean,
): ContentBlockParam[] {
  const blocks: ContentBlockParam[] = [];
  for (const block of msg.content) {
    if (block.type === "text") {
      if (block.text.trim().length === 0) continue;
      blocks.push({ text: sanitizeSurrogates(block.text), type: "text" });
    } else if (block.type === "thinking") {
      const converted = convertThinkingBlock(block, allowEmptySignature);
      if (converted !== undefined) blocks.push(converted);
    } else if (block.type === "toolCall") {
      blocks.push({
        id: block.id,
        input: block.arguments ?? {},
        name: block.name,
        type: "tool_use",
      });
    }
  }
  return blocks;
}

function collectToolResults(
  messages: ReadonlyArray<typesModule.Message>,
  start: number,
): { blocks: ContentBlockParam[]; nextIndex: number } {
  const blocks: ContentBlockParam[] = [];
  let index = start;
  let next = messages[index];
  while (next?.role === "toolResult") {
    blocks.push(convertToolResult(next));
    next = messages[++index];
  }
  return { blocks, nextIndex: index - 1 };
}

function applyCacheControlToLastMessage(
  params: MessageParam[],
  cacheControl: CacheControlEphemeral,
): void {
  const lastMessage = params.at(-1);
  if (lastMessage?.role !== "user" && lastMessage?.role !== "system") return;
  if (Array.isArray(lastMessage.content)) {
    const lastBlock = lastMessage.content.at(-1);
    if (
      lastBlock !== undefined &&
      (lastBlock.type === "text" ||
        lastBlock.type === "image" ||
        lastBlock.type === "tool_result" ||
        lastBlock.type === "tool_addition" ||
        lastBlock.type === "tool_removal")
    ) {
      (lastBlock as any).cache_control = cacheControl;
    }
    return;
  }
  if (typeof lastMessage.content !== "string") return;
  lastMessage.content = [
    {
      cache_control: cacheControl,
      text: lastMessage.content,
      type: "text",
    },
  ] as any;
}

function convertAssistantMessage(
  msg: Extract<typesModule.Message, { role: "assistant" }>,
  options: anthropicMessagesConvertTypes.ConvertMessagesOptions,
):
  | { message: MessageParam; effort: anthropicMessagesCompatTypes.AnthropicEffort | undefined }
  | undefined {
  const blocks = convertAssistantBlocks(msg, options.allowEmptySignature ?? false);
  if (blocks.length === 0) return undefined;
  const effort =
    options.managedProvider !== undefined &&
    msg.api === "anthropic-messages" &&
    msg.provider === options.managedProvider &&
    isAnthropicEffort(msg.providerThinkingLevel)
      ? msg.providerThinkingLevel
      : undefined;
  return { effort, message: { content: blocks, role: "assistant" } };
}

function convertMessages(
  input: anthropicMessagesConvertTypes.ConvertMessagesInput,
): anthropicMessagesConvertTypes.ConvertedAnthropicMessages {
  const { messages: transformedMessages, ...options } = input;
  const params: MessageParam[] = [];
  const assistantLevels = new Map<number, anthropicMessagesCompatTypes.AnthropicEffort>();
  const pendingSystemMessages: MessageParam[] = [];
  const flushPendingSystemMessages = (): void => {
    params.push(...pendingSystemMessages);
    pendingSystemMessages.length = 0;
  };

  for (let i = 0; i < transformedMessages.length; i++) {
    const msg = transformedMessages[i];
    if (msg === undefined) continue;

    if (msg.role === "system") {
      const converted = convertSystemMessage(msg, options.convertToolDefinitions);
      if (converted !== undefined) pendingSystemMessages.push(converted);
    } else if (msg.role === "user") {
      const converted = convertUserMessage(msg);
      if (converted !== undefined) params.push(converted);
    } else if (msg.role === "assistant") {
      flushPendingSystemMessages();
      const converted = convertAssistantMessage(msg, options);
      if (converted !== undefined) {
        const messageIndex = params.length;
        params.push(converted.message);
        if (converted.effort !== undefined) assistantLevels.set(messageIndex, converted.effort);
      }
    } else if (msg.role === "toolResult") {
      const collected = collectToolResults(transformedMessages, i);
      i = collected.nextIndex;
      params.push({ content: collected.blocks, role: "user" });
    }
  }

  flushPendingSystemMessages();

  if (options.cacheControl !== undefined && params.length > 0) {
    applyCacheControlToLastMessage(params, options.cacheControl);
  }

  return { assistantLevels, messages: params };
}
function insertThinkingLevelMessages(
  input: anthropicMessagesConvertTypes.InsertThinkingLevelMessagesInput,
): MessageParam[] {
  const { converted, activeEffort } = input;
  const messages: MessageParam[] = [];
  for (const [index, message] of converted.messages.entries()) {
    const historicalEffort = converted.assistantLevels.get(index);
    if (historicalEffort !== undefined) {
      messages.push({ content: [], output_config: { effort: historicalEffort }, role: "system" });
    }
    messages.push(message);
  }
  messages.push({ content: [], output_config: { effort: activeEffort }, role: "system" });
  return messages;
}

const anthropicMessagesConvert = {
  convertMessages,
  insertThinkingLevelMessages,
  normalizeToolCallId,
};

export default anthropicMessagesConvert;
