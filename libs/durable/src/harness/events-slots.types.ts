import type eventsTypesModule from "./events-types.ts";
import type liveTypes from "./live.types.ts";

declare namespace eventsSlotsTypes {
  type Slots = {
    readonly slotsBefore: Map<string, liveTypes.ToolSlot>;
    readonly slots: readonly liveTypes.ToolSlot[];
    readonly nestedBefore: Map<TaskKey, liveTypes.NestedToolSlot>;
    readonly nested: readonly liveTypes.NestedToolSlot[];
  };

  type TaskKey = liveTypes.NestedToolSlot["taskId"];

  type ToolEnd = Extract<eventsTypesModule.AgentEvent, { type: "tool_execution_end" }>;
}

export type { eventsSlotsTypes as default };
