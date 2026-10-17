import type { AssistantMessage, Message } from "@msa/ai";
import { Function } from "effect";

import type { Dual2 } from "./types.ts";

const TOOL_RESULT_MAX_CHARS = 2000;

export const SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
export const SUMMARY_SUFFIX = "\n</summary>";

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work. If the conversation starts with an earlier summary, preserve its information and fold the newer messages into it.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export function summaryText(message: AssistantMessage): string | undefined {
  if (
    message.stopReason !== "stop" ||
    message.content.some((content) => content.type === "toolCall")
  )
    return undefined;
  const text = message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n")
    .trim();
  return text.length === 0 ? undefined : text;
}

export function summaryFailure(message: AssistantMessage): string {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    return `Summarization failed: ${message.errorMessage ?? message.stopReason}`;
  }
  if (message.stopReason === "length")
    return "Summarization hit the token limit; the summary is incomplete";
  if (message.content.some((content) => content.type === "toolCall"))
    return "Summarization attempted to call a tool";
  return "Summarization produced no text";
}

export const summaryPrompt: Dual2<readonly Message[], string | undefined, string> = Function.dual(
  2,
  (messages: readonly Message[], instructions: string | undefined): string => {
    const focus = instructions === undefined ? "" : `\n\nAdditional focus: ${instructions}`;
    return `<conversation>\n${serializeConversation(messages)}\n</conversation>\n\n${SUMMARIZATION_PROMPT}${focus}`;
  },
);

export function serializeConversation(messages: readonly Message[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = contentText(message.content);
      if (text.length > 0) parts.push(`[User]: ${text}`);
    } else if (message.role === "assistant") {
      const text = message.content.flatMap((content) =>
        content.type === "text" ? [content.text] : [],
      );
      const calls = message.content.flatMap((content) =>
        content.type === "toolCall"
          ? [
              `${content.name}(${Object.entries(content.arguments)
                .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                .join(", ")})`,
            ]
          : [],
      );
      if (text.length > 0) parts.push(`[Assistant]: ${text.join("\n")}`);
      if (calls.length > 0) parts.push(`[Assistant tool calls]: ${calls.join("; ")}`);
    } else if (message.role === "toolResult") {
      const text = contentText(message.content);
      if (text.length > 0) parts.push(`[Tool result]: ${truncate(text, TOOL_RESULT_MAX_CHARS)}`);
    }
  }
  return parts.join("\n\n");
}

function contentText(
  content: string | readonly { readonly type: string; readonly text?: string }[],
): string {
  if (typeof content === "string") return content;
  return content
    .flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []))
    .join("\n");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[... ${text.length - maxChars} more characters truncated]`;
}
