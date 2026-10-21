import type agentOptionsTypes from "./agent-options.ts";
import type agentStateTypes from "./agent-state.types.ts";
import type AgentClass from "./agent.ts";
import type typesModule from "./types.ts";

declare namespace agentTypes {
  type AgentOptions = agentOptionsTypes.AgentOptions;

  type AgentInitialState = agentStateTypes.AgentInitialState;

  type QueueMode = typesModule.QueueMode;

  type Agent = AgentClass;
}

export type { agentTypes as default };
