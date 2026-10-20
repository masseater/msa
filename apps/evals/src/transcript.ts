import ai from "@msa/ai";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { type TranscriptEvent, normalizeRecord, toJsonValue } from "vitest-evals/harness";

const { contentText } = ai;

type SessionMessage = codingAgentTypes.AgentSession["messages"][number];

function assistantEvents(message: Extract<SessionMessage, { role: "assistant" }>) {
  const events: TranscriptEvent[] = [];
  const text = contentText(message.content, "\n");
  if (text !== "") events.push({ content: text, role: "assistant", type: "message" });
  for (const part of message.content) {
    if (part.type !== "toolCall") continue;
    events.push({
      arguments: normalizeRecord(part.arguments),
      id: part.id,
      name: part.name,
      type: "tool_call",
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
    name: message.toolName,
    toolCallId: message.toolCallId,
    type: "tool_result",
    ...(content === undefined ? {} : { content }),
    ...(message.isError ? { error: { message: failureMessage } } : {}),
  };
  return event;
}

function messageEvents(message: SessionMessage): TranscriptEvent[] {
  if (message.role === "user") {
    return [{ content: contentText(message.content, "\n"), role: "user", type: "message" }];
  }
  if (message.role === "assistant") return assistantEvents(message);
  if (message.role === "toolResult") return [toolResultEvent(message)];
  return [];
}

function toTranscriptEvents(
  messages: codingAgentTypes.AgentSession["messages"],
): TranscriptEvent[] {
  return messages.flatMap(messageEvents);
}

const transcript = {
  toTranscriptEvents,
};

export default transcript;
