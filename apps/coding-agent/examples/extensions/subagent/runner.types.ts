import type agentsTypes from "./agents.types.ts";
import type subagentTypesTypes from "./types.types.ts";

declare namespace runnerTypes {
  interface RunSingleRequest {
    readonly defaultCwd: string;
    readonly dispatchDefaults: subagentTypesTypes.DispatchDefaults;
    readonly agents: agentsTypes.AgentConfig[];
    readonly agentName: string;
    readonly task: string;
    readonly cwd: string | undefined;
    readonly step: number | undefined;
    readonly signal: AbortSignal | undefined;
    readonly onUpdate: subagentTypesTypes.OnUpdateCallback | undefined;
    readonly makeDetails: (
      results: subagentTypesTypes.SingleResult[],
    ) => subagentTypesTypes.SubagentDetails;
  }
}

export type { runnerTypes as default };
