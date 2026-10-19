import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import type {
  ImageContent,
  Message,
  StopReason,
  TextContent,
  ThinkingContent,
  Tool,
} from "@msa/ai";

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
  readonly tools?: Tool[];
}): string => {
  const { name, tools } = request;
  const lowerName = name.toLowerCase();
  return tools?.find((t) => t.name.toLowerCase() === lowerName)?.name ?? name;
};

export const sanitizeSurrogates = (text: string): string =>
  text.replace(/[\uD800-\uDFFF]/gu, "\uFFFD");

const imageBlock = (item: ImageContent) => ({
  type: "image" as const,
  source: {
    type: "base64" as const,
    media_type: item.mimeType as "image/jpeg",
    data: item.data,
  },
});

export const convertContentBlocks = (
  content: (TextContent | ImageContent)[],
): string | ContentBlockParam[] => {
  if (!content.some((c) => c.type === "image")) {
    return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
  }

  const blocks: ContentBlockParam[] = content.map((block) =>
    block.type === "text"
      ? { type: "text" as const, text: sanitizeSurrogates(block.text) }
      : imageBlock(block),
  );

  if (!blocks.some((b) => b.type === "text")) {
    blocks.unshift({ type: "text" as const, text: "(see attached image)" });
  }
  return blocks;
};

const convertUserMessage = (msg: Message): ContentBlockParam[] | undefined => {
  if (typeof msg.content === "string") {
    return msg.content.trim().length > 0
      ? [{ type: "text", text: sanitizeSurrogates(msg.content) }]
      : undefined;
  }

  const blocks: ContentBlockParam[] = [];
  for (const item of msg.content) {
    if (item.type === "text") {
      blocks.push({ type: "text", text: sanitizeSurrogates(item.text) });
    } else if (item.type === "image") {
      blocks.push(imageBlock(item));
    }
  }
  return blocks.length > 0 ? blocks : undefined;
};

const convertThinkingBlock = (block: ThinkingContent): ContentBlockParam => {
  const signature = block.thinkingSignature ?? "";
  if (signature.length > 0) {
    return {
      type: "thinking",
      thinking: sanitizeSurrogates(block.thinking),
      signature,
    } as unknown as ContentBlockParam;
  }
  return { type: "text", text: sanitizeSurrogates(block.thinking) };
};

const convertAssistantMessage = (msg: Message, isOAuth: boolean): ContentBlockParam[] => {
  if (typeof msg.content === "string") return [];

  const blocks: ContentBlockParam[] = [];
  for (const block of msg.content) {
    if (block.type === "text" && block.text.trim().length > 0) {
      blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
    } else if (block.type === "thinking" && block.thinking.trim().length > 0) {
      blocks.push(convertThinkingBlock(block));
    } else if (block.type === "toolCall") {
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: isOAuth ? toClaudeCodeName(block.name) : block.name,
        input: block.arguments,
      });
    }
  }
  return blocks;
};

const toolResultBlock = (msg: Message) => ({
  type: "tool_result" as const,
  tool_use_id: (msg as { toolCallId: string }).toolCallId,
  content: convertContentBlocks((msg as { content: (TextContent | ImageContent)[] }).content),
  is_error: (msg as { isError: boolean }).isError,
});

const convertToolResults = (
  messages: Message[],
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
  readonly messages: Message[];
  readonly isOAuth: boolean;
}): unknown[] => {
  const { messages, isOAuth } = request;
  const params: { role: string; content: unknown }[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg === undefined) continue;

    if (msg.role === "user") {
      const content = convertUserMessage(msg);
      if (content !== undefined) params.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const content = convertAssistantMessage(msg, isOAuth);
      if (content.length > 0) params.push({ role: "assistant", content });
    } else if (msg.role === "toolResult") {
      const { blocks, next } = convertToolResults(messages, i);
      i = next - 1;
      params.push({ role: "user", content: blocks });
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
  readonly tools: Tool[];
  readonly isOAuth: boolean;
}): unknown[] =>
  request.tools.map((tool) => ({
    name: request.isOAuth ? toClaudeCodeName(tool.name) : tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: (tool.parameters as { properties?: unknown }).properties ?? {},
      required: (tool.parameters as { required?: unknown }).required ?? [],
    },
  }));

export const mapStopReason = (reason: string): StopReason => {
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
