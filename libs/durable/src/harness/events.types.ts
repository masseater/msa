import type eventsTypesModule from "./events-types.ts";

declare namespace eventsTypes {
  type AgentEvent = eventsTypesModule.AgentEvent;

  type AgentEventStream = eventsTypesModule.AgentEventStream;

  type MessageChange = eventsTypesModule.MessageChange;

  type SnapshotEvent = eventsTypesModule.SnapshotEvent;

  type ToolEventCall = eventsTypesModule.ToolEventCall;
}

export type { eventsTypes as default };
