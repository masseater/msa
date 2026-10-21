import type eventsTypesModule from "./events-types.ts";

declare namespace eventsToolsTypes {
  type ToolUpdate =
    | Omit<
        Extract<eventsTypesModule.AgentEvent, { type: "tool_execution_update" }>,
        "type" | keyof eventsTypesModule.ToolEventCall
      >
    | undefined;
}

export type { eventsToolsTypes as default };
