import type durableTypes from "@msa/durable/index.types";

import type harnessEventsAgent2CasesTypes from "./harness-events-agent-2-cases.ts";

declare namespace harnessEventsAgent2TestTypes {
  type LiveMessage = harnessEventsAgent2CasesTypes.LiveMessage;

  type AgentEvent = durableTypes.AgentEvent;

  type AgentEventStream = durableTypes.AgentEventStream;

  type LiveState = durableTypes.LiveState;

  type SnapshotEvent = durableTypes.SnapshotEvent;
}

export type { harnessEventsAgent2TestTypes as default };
