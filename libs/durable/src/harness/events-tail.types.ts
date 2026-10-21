import type eventsChangesTypes from "./events-changes.types.ts";
import type eventsTypesModule from "./events-types.ts";

declare namespace eventsTailTypes {
  type TaskEvents = {
    readonly events: eventsTypesModule.AgentEvent[];
    readonly turnEnded: boolean;
  };

  type Changes = eventsChangesTypes.Changes;
}

export type { eventsTailTypes as default };
