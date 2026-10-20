import type aiTypes from "@msa/ai/index.types";

import type agentSessionTypes from "../core/agent-session.types.ts";

declare namespace jsonEventTypes {
  type WithoutPartial<T> = T extends { partial: unknown } ? Omit<T, "partial"> : T;

  type ToJsonAssistantMessageEvent<T> = T extends { type: "toolcall_start"; partial: unknown }
    ? WithoutPartial<T> & { id: string; toolName: string }
    : WithoutPartial<T>;

  type MessageUpdateEvent = Extract<
    agentSessionTypes.AgentSessionEvent,
    { type: "message_update" }
  >;

  type JsonMessageUpdateEvent = {
    type: "message_update";
    usage: aiTypes.Usage;
    assistantMessageEvent: ToJsonAssistantMessageEvent<MessageUpdateEvent["assistantMessageEvent"]>;
  };

  type JsonAgentSessionEvent =
    | Exclude<agentSessionTypes.AgentSessionEvent, { type: "message_update" }>
    | JsonMessageUpdateEvent;
}

export type { jsonEventTypes as default };
