import type observationTypes from "../session/observation.types.ts";
import type eventsTypesModule from "./events-types.ts";

declare namespace eventsAttachTypes {
  type Attached = {
    readonly watch: observationTypes.CommittedWatch<readonly eventsTypesModule.AgentEvent[]>;
    readonly snapshot: eventsTypesModule.SnapshotEvent;
  };

  type AgentEvent = eventsTypesModule.AgentEvent;
}

export type { eventsAttachTypes as default };
