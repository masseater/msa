import type {
  BetaCacheControlEphemeral as CacheControlEphemeral,
  BetaContentBlockParam as ContentBlockParam,
  BetaMessageParam as MessageParam,
  BetaTool,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type { Message, Tool, ToolResultMessage } from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { renderSystemMessageUpdate } from "../utils/text.ts";
import { isAnthropicEffort, type AnthropicEffort } from "./anthropic-messages-compat.ts";
import { convertContentBlocks, toClaudeCodeName } from "./anthropic-messages-content.ts";

function normalizeToolCallId(id: string): string {
  return id.replaceAll(/[^a-zA-Z0-9_-]/gu, (char) => "_".repeat(char.length)).slice(0, 64);
}

function convertToolResult(msg: ToolResultMessage): ContentBlockParam {
  const content = msg.isError
    ? msg.content.map((block) =>
        block.type === "image"
          ? {
              type: "text" as const,
              text: "[image omitted: error tool results cannot contain images]",
            }
          : block,
      )
    : msg.content;
  return {
    type: "tool_result",
    tool_use_id: msg.toolCallId,
    content: convertContentBlocks(content),
    is_error: msg.isError,
  };
}

type ToolDefinitionsConverter = (tools: Tool[]) => BetaTool[];

function convertSystemMessage(
  msg: Extract<Message, { role: "system" }>,
  usesOAuth: boolean,
  convertToolDefinitions: ToolDefinitionsConverter | undefined,
): MessageParam | undefined {
  const text = renderSystemMessageUpdate(msg);
  const blocks: ContentBlockParam[] = [];
  if (text.length > 0) blocks.push({ type: "text", text: sanitizeSurrogates(text) });
  if (convertToolDefinitions !== undefined) {
    const added = msg.toolsAdded ?? [];
    const redefined = new Set(added.map((tool) => tool.name));
    for (const tool of msg.toolsRemoved ?? []) {
      if (redefined.has(tool.name)) continue;
      blocks.push({
        type: "tool_removal",
        tool: {
          type: "tool_reference",
          name: usesOAuth ? toClaudeCodeName(tool.name) : tool.name,
        },
      });
    }
    for (const definition of convertToolDefinitions(added)) {
      blocks.push({ type: "tool_addition", tool: { type: "tool_definition", definition } });
    }
  }
  return blocks.length > 0 ? { role: "system", content: blocks } : undefined;
}

function convertUserMessage(msg: Extract<Message, { role: "user" }>): MessageParam | undefined {
  if (typeof msg.content === "string") {
    if (msg.content.trim().length === 0) return undefined;
    return { role: "user", content: sanitizeSurrogates(msg.content) };
  }
  const blocks = msg.content.map((item): ContentBlockParam =>
    item.type === "text"
      ? { type: "text", text: sanitizeSurrogates(item.text) }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: item.data,
          },
        },
  );
  const filteredBlocks = blocks.filter((b) =>
    b.type === "text" ? b.text.trim().length > 0 : true,
  );
  if (filteredBlocks.length === 0) return undefined;
  return { role: "user", content: filteredBlocks };
}

function convertThinkingBlock(
  block: Extract<Message, { role: "assistant" }>["content"][number] & { type: "thinking" },
  allowEmptySignature: boolean,
): ContentBlockParam | undefined {
  if (block.redacted === true) {
    return { type: "redacted_thinking", data: block.thinkingSignature! };
  }
  const thinkingSignature = block.thinkingSignature;
  const hasThinkingSignature =
    thinkingSignature !== undefined &&
    thinkingSignature !== "" &&
    thinkingSignature.trim().length > 0;
  if (block.thinking.trim().length === 0 && !hasThinkingSignature) return undefined;
  if (hasThinkingSignature) {
    return {
      type: "thinking",
      thinking: sanitizeSurrogates(block.thinking),
      signature: thinkingSignature,
    };
  }
  return allowEmptySignature
    ? { type: "thinking", thinking: sanitizeSurrogates(block.thinking), signature: "" }
    : { type: "text", text: sanitizeSurrogates(block.thinking) };
}

function convertAssistantBlocks(
  msg: Extract<Message, { role: "assistant" }>,
  usesOAuth: boolean,
  allowEmptySignature: boolean,
): ContentBlockParam[] {
  const blocks: ContentBlockParam[] = [];
  for (const block of msg.content) {
    if (block.type === "text") {
      if (block.text.trim().length === 0) continue;
      blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
    } else if (block.type === "thinking") {
      const converted = convertThinkingBlock(block, allowEmptySignature);
      if (converted !== undefined) blocks.push(converted);
    } else if (block.type === "toolCall") {
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: usesOAuth ? toClaudeCodeName(block.name) : block.name,
        input: block.arguments ?? {},
      });
    }
  }
  return blocks;
}

function collectToolResults(
  messages: ReadonlyArray<Message>,
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
      type: "text",
      text: lastMessage.content,
      cache_control: cacheControl,
    },
  ] as any;
}

interface ConvertedAnthropicMessages {
  messages: MessageParam[];
  assistantLevels: Map<number, AnthropicEffort>;
}

interface ConvertMessagesOptions {
  usesOAuth: boolean;
  cacheControl?: CacheControlEphemeral | undefined;
  allowEmptySignature?: boolean | undefined;
  managedProvider?: string | undefined;
  convertToolDefinitions?: ToolDefinitionsConverter | undefined;
}

function convertAssistantMessage(
  msg: Extract<Message, { role: "assistant" }>,
  options: ConvertMessagesOptions,
): { message: MessageParam; effort: AnthropicEffort | undefined } | undefined {
  const blocks = convertAssistantBlocks(
    msg,
    options.usesOAuth,
    options.allowEmptySignature ?? false,
  );
  if (blocks.length === 0) return undefined;
  const effort =
    options.managedProvider !== undefined &&
    msg.api === "anthropic-messages" &&
    msg.provider === options.managedProvider &&
    isAnthropicEffort(msg.providerThinkingLevel)
      ? msg.providerThinkingLevel
      : undefined;
  return { message: { role: "assistant", content: blocks }, effort };
}

interface ConvertMessagesInput extends ConvertMessagesOptions {
  readonly messages: Message[];
}

function convertMessages(input: ConvertMessagesInput): ConvertedAnthropicMessages {
  const { messages: transformedMessages, ...options } = input;
  const params: MessageParam[] = [];
  const assistantLevels = new Map<number, AnthropicEffort>();
  const pendingSystemMessages: MessageParam[] = [];
  const flushPendingSystemMessages = (): void => {
    params.push(...pendingSystemMessages);
    pendingSystemMessages.length = 0;
  };

  for (let i = 0; i < transformedMessages.length; i++) {
    const msg = transformedMessages[i];
    if (msg === undefined) continue;

    if (msg.role === "system") {
      const converted = convertSystemMessage(
        msg,
        options.usesOAuth,
        options.convertToolDefinitions,
      );
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
      params.push({ role: "user", content: collected.blocks });
    }
  }

  flushPendingSystemMessages();

  if (options.cacheControl !== undefined && params.length > 0) {
    applyCacheControlToLastMessage(params, options.cacheControl);
  }

  return { messages: params, assistantLevels };
}

interface InsertThinkingLevelMessagesInput {
  readonly converted: ConvertedAnthropicMessages;
  readonly activeEffort: AnthropicEffort;
}

function insertThinkingLevelMessages(input: InsertThinkingLevelMessagesInput): MessageParam[] {
  const { converted, activeEffort } = input;
  const messages: MessageParam[] = [];
  for (const [index, message] of converted.messages.entries()) {
    const historicalEffort = converted.assistantLevels.get(index);
    if (historicalEffort !== undefined) {
      messages.push({ role: "system", content: [], output_config: { effort: historicalEffort } });
    }
    messages.push(message);
  }
  messages.push({ role: "system", content: [], output_config: { effort: activeEffort } });
  return messages;
}

export {
  convertMessages,
  insertThinkingLevelMessages,
  normalizeToolCallId,
  type ConvertMessagesInput,
  type ConvertMessagesOptions,
  type ConvertedAnthropicMessages,
  type ToolDefinitionsConverter,
};
