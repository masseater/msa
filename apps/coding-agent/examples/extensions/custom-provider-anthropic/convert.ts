import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import type aiTypes from "@msa/ai/index.types";

const CLAUDE_CODE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "AskUserQuestion",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
];

const claudeCodeLookup = new Map(CLAUDE_CODE_TOOLS.map((t) => [t.toLowerCase(), t]));

export const toClaudeCodeName = (name: string): string =>
  claudeCodeLookup.get(name.toLowerCase()) ?? name;

export const fromClaudeCodeName = (request: {
  readonly name: string;
  readonly tools?: aiTypes.Tool[];
}): string => {
  const { name, tools } = request;
  const lowerName = name.toLowerCase();
  return tools?.find((t) => t.name.toLowerCase() === lowerName)?.name ?? name;
};

export const sanitizeSurrogates = (text: string): string =>
  text.replace(/[\uD800-\uDFFF]/gu, "\uFFFD");

const imageBlock = (item: aiTypes.ImageContent) => ({
  source: {
    data: item.data,
    media_type: item.mimeType as "image/jpeg",
    type: "base64" as const,
  },
  type: "image" as const,
});

export const convertContentBlocks = (
  content: (aiTypes.TextContent | aiTypes.ImageContent)[],
): string | ContentBlockParam[] => {
  if (!content.some((c) => c.type === "image")) {
    return sanitizeSurrogates(content.map((c) => (c as aiTypes.TextContent).text).join("\n"));
  }

  const blocks: ContentBlockParam[] = content.map((block) =>
    block.type === "text"
      ? { text: sanitizeSurrogates(block.text), type: "text" as const }
      : imageBlock(block),
  );

  if (!blocks.some((b) => b.type === "text")) {
    blocks.unshift({ text: "(see attached image)", type: "text" as const });
  }
  return blocks;
};

const convertUserMessage = (msg: aiTypes.Message): ContentBlockParam[] | undefined => {
  if (typeof msg.content === "string") {
    return msg.content.trim().length > 0
      ? [{ text: sanitizeSurrogates(msg.content), type: "text" }]
      : undefined;
  }

  const blocks: ContentBlockParam[] = [];
  for (const item of msg.content) {
    if (item.type === "text") {
      blocks.push({ text: sanitizeSurrogates(item.text), type: "text" });
    } else if (item.type === "image") {
      blocks.push(imageBlock(item));
    }
  }
  return blocks.length > 0 ? blocks : undefined;
};

const convertThinkingBlock = (block: aiTypes.ThinkingContent): ContentBlockParam => {
  const signature = block.thinkingSignature ?? "";
  if (signature.length > 0) {
    return {
      signature,
      thinking: sanitizeSurrogates(block.thinking),
      type: "thinking",
    } as unknown as ContentBlockParam;
  }
  return { text: sanitizeSurrogates(block.thinking), type: "text" };
};

const convertAssistantMessage = (msg: aiTypes.Message, isOAuth: boolean): ContentBlockParam[] => {
  if (typeof msg.content === "string") return [];

  const blocks: ContentBlockParam[] = [];
  for (const block of msg.content) {
    if (block.type === "text" && block.text.trim().length > 0) {
      blocks.push({ text: sanitizeSurrogates(block.text), type: "text" });
    } else if (block.type === "thinking" && block.thinking.trim().length > 0) {
      blocks.push(convertThinkingBlock(block));
    } else if (block.type === "toolCall") {
      blocks.push({
        id: block.id,
        input: block.arguments,
        name: isOAuth ? toClaudeCodeName(block.name) : block.name,
        type: "tool_use",
      });
    }
  }
  return blocks;
};

const toolResultBlock = (msg: aiTypes.Message) => ({
  content: convertContentBlocks(
    (msg as { content: (aiTypes.TextContent | aiTypes.ImageContent)[] }).content,
  ),
  is_error: (msg as { isError: boolean }).isError,
  tool_use_id: (msg as { toolCallId: string }).toolCallId,
  type: "tool_result" as const,
});

const convertToolResults = (
  messages: aiTypes.Message[],
  start: number,
): { blocks: unknown[]; next: number } => {
  const blocks: unknown[] = [];
  let index = start;
  let msg = messages[index];
  while (msg?.role === "toolResult") {
    blocks.push(toolResultBlock(msg));
    index++;
    msg = messages[index];
  }
  return { blocks, next: index };
};

export const convertMessages = (request: {
  readonly messages: aiTypes.Message[];
  readonly isOAuth: boolean;
}): unknown[] => {
  const { messages, isOAuth } = request;
  const params: { role: string; content: unknown }[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg === undefined) continue;

    if (msg.role === "user") {
      const content = convertUserMessage(msg);
      if (content !== undefined) params.push({ content, role: "user" });
    } else if (msg.role === "assistant") {
      const content = convertAssistantMessage(msg, isOAuth);
      if (content.length > 0) params.push({ content, role: "assistant" });
    } else if (msg.role === "toolResult") {
      const { blocks, next } = convertToolResults(messages, i);
      i = next - 1;
      params.push({ content: blocks, role: "user" });
    }
  }

  const last = params.at(-1);
  if (last !== undefined && Array.isArray(last.content)) {
    const lastBlock = last.content.at(-1);
    if (lastBlock !== undefined) {
      (lastBlock as { cache_control?: unknown }).cache_control = { type: "ephemeral" };
    }
  }

  return params;
};

export const convertTools = (request: {
  readonly tools: aiTypes.Tool[];
  readonly isOAuth: boolean;
}): unknown[] =>
  request.tools.map((tool) => ({
    description: tool.description,
    input_schema: {
      properties: (tool.parameters as { properties?: unknown }).properties ?? {},
      required: (tool.parameters as { required?: unknown }).required ?? [],
      type: "object",
    },
    name: request.isOAuth ? toClaudeCodeName(tool.name) : tool.name,
  }));

export const mapStopReason = (reason: string): aiTypes.StopReason => {
  switch (reason) {
    case "end_turn":
    case "pause_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "toolUse";
    default:
      return "error";
  }
};
