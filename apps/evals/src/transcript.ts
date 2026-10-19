import { contentText } from "@msa/ai";
import type { AgentSession } from "@msa/coding-agent";
import { normalizeRecord, toJsonValue, type TranscriptEvent } from "vitest-evals/harness";

type SessionMessage = AgentSession["messages"][number];

function assistantEvents(message: Extract<SessionMessage, { role: "assistant" }>) {
  const events: TranscriptEvent[] = [];
  const text = contentText(message.content, "\n");
  if (text !== "") events.push({ type: "message", role: "assistant", content: text });
  for (const part of message.content) {
    if (part.type !== "toolCall") continue;
    events.push({
      type: "tool_call",
      id: part.id,
      name: part.name,
      arguments: normalizeRecord(part.arguments),
    });
  }
  return events;
}

function toolResultEvent(message: Extract<SessionMessage, { role: "toolResult" }>) {
  const text = contentText(message.content, "\n");
  const content = message.content.every((part) => part.type === "text")
    ? text
    : toJsonValue(message.content);
  const failureMessage = text === "" ? "Tool failed" : text;
  const event: TranscriptEvent = {
    type: "tool_result",
    toolCallId: message.toolCallId,
    name: message.toolName,
    ...(content === undefined ? {} : { content }),
    ...(message.isError ? { error: { message: failureMessage } } : {}),
  };
  return event;
}

function messageEvents(message: SessionMessage): TranscriptEvent[] {
  if (message.role === "user") {
    return [{ type: "message", role: "user", content: contentText(message.content, "\n") }];
  }
  if (message.role === "assistant") return assistantEvents(message);
  if (message.role === "toolResult") return [toolResultEvent(message)];
  return [];
}

export function toTranscriptEvents(messages: AgentSession["messages"]): TranscriptEvent[] {
  return messages.flatMap(messageEvents);
}
