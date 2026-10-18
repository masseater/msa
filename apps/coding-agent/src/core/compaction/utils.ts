import type { AgentMessage } from "@msa/agent-core";
import { contentText, type Message } from "@msa/ai";
import { Function as Fn } from "effect";

export interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

export function createFileOps(): FileOperations {
  return {
    read: new Set(),
    written: new Set(),
    edited: new Set(),
  };
}

const extractFileOpsFromMessageImpl = (message: AgentMessage, fileOps: FileOperations): void => {
  if (message.role === "toolResult") {
    for (const call of message.nestedCalls?.calls ?? [])
      addFileOp(call.name, call.arguments, fileOps);
    return;
  }
  if (message.role !== "assistant") return;
  if (!("content" in message) || !Array.isArray(message.content)) return;

  for (const block of message.content) {
    if (typeof block !== "object" || block === null) continue;
    if (!("type" in block) || block.type !== "toolCall") continue;
    if (!("arguments" in block) || !("name" in block)) continue;
    addFileOp(block.name, block.arguments as Record<string, unknown> | undefined, fileOps);
  }
};

export const extractFileOpsFromMessage: {
  (fileOps: FileOperations): (message: AgentMessage) => void;
  (message: AgentMessage, fileOps: FileOperations): void;
} = Fn.dual(2, extractFileOpsFromMessageImpl);

function addFileOp(
  toolName: string,
  args: Record<string, unknown> | undefined,
  fileOps: FileOperations,
): void {
  const path = typeof args?.["path"] === "string" ? args["path"] : undefined;
  if (path === undefined || path === "") return;
  switch (toolName) {
    case "read":
      fileOps.read.add(path);
      break;
    case "write":
      fileOps.written.add(path);
      break;
    case "edit":
      fileOps.edited.add(path);
      break;
  }
}

export function computeFileLists(fileOps: FileOperations): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  const readOnly = [...fileOps.read].filter((f) => !modified.has(f)).sort();
  const modifiedFiles = [...modified].sort();
  return { readFiles: readOnly, modifiedFiles };
}

const formatFileOperationsImpl = (readFiles: string[], modifiedFiles: string[]): string => {
  const sections: string[] = [];
  if (readFiles.length > 0) {
    sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  }
  if (sections.length === 0) return "";
  return `\n\n${sections.join("\n\n")}`;
};

export const formatFileOperations: {
  (modifiedFiles: string[]): (readFiles: string[]) => string;
  (readFiles: string[], modifiedFiles: string[]): string;
} = Fn.dual(2, formatFileOperationsImpl);

const TOOL_RESULT_MAX_CHARS = 2000;

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncatedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

const serializeConversationImpl = (
  messages: Message[],
  truncateToolResult: (text: string) => string = (text) =>
    truncateForSummary(text, TOOL_RESULT_MAX_CHARS),
): string => {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content = contentText(msg.content, "");
      if (content !== "") parts.push(`[User]: ${content}`);
    } else if (msg.role === "assistant") {
      const toolCalls: string[] = [];

      for (const block of msg.content) {
        if (block.type === "toolCall") {
          const args = block.arguments as Record<string, unknown>;
          const argsStr = Object.entries(args)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(", ");
          toolCalls.push(`${block.name}(${argsStr})`);
        }
      }

      if (msg.content.some((block) => block.type === "text")) {
        parts.push(`[Assistant]: ${contentText(msg.content, "\n")}`);
      }
      if (toolCalls.length > 0) {
        parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
      }
    } else if (msg.role === "toolResult") {
      const content = contentText(msg.content, "");
      if (content !== "") {
        parts.push(`[Tool result]: ${truncateToolResult(content)}`);
      }
    }
  }

  return parts.join("\n\n");
};

export const serializeConversation: {
  (truncateToolResult?: (text: string) => string): (messages: Message[]) => string;
  (messages: Message[], truncateToolResult?: (text: string) => string): string;
} = Fn.dual((args) => Array.isArray(args[0]), serializeConversationImpl);

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;
