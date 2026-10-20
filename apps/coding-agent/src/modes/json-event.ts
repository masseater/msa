import type agentSessionTypes from "../core/agent-session.types.ts";
import type jsonEventTypes from "./json-event.types.ts";

function toJsonAssistantMessageEvent(
  event: jsonEventTypes.MessageUpdateEvent["assistantMessageEvent"],
): jsonEventTypes.JsonMessageUpdateEvent["assistantMessageEvent"] {
  if (event.type === "toolcall_start") {
    const toolCall = event.partial.content[event.contentIndex];
    if (toolCall?.type !== "toolCall") {
      throw new Error(`toolcall_start content at index ${event.contentIndex} is not a tool call`);
    }
    const { partial: _partial, ...deltaEvent } = event;
    return { ...deltaEvent, id: toolCall.id, toolName: toolCall.name };
  }

  if (!("partial" in event)) {
    return event;
  }

  const { partial: _partial, ...deltaEvent } = event;
  return deltaEvent;
}

function toJsonEvent(
  event: jsonEventTypes.MessageUpdateEvent,
): jsonEventTypes.JsonMessageUpdateEvent;
function toJsonEvent(
  event: agentSessionTypes.AgentSessionEvent,
): jsonEventTypes.JsonAgentSessionEvent;
function toJsonEvent(
  event: agentSessionTypes.AgentSessionEvent,
): jsonEventTypes.JsonAgentSessionEvent {
  if (event.type !== "message_update") {
    return event;
  }
  if (event.message.role !== "assistant") {
    throw new Error("message_update message is not an assistant message");
  }

  return {
    assistantMessageEvent: toJsonAssistantMessageEvent(event.assistantMessageEvent),
    type: "message_update",
    usage: event.message.usage,
  };
}

const jsonEvent = {
  toJsonEvent,
};

export default jsonEvent;
