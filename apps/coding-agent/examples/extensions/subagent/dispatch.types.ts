import type codingAgentTypes from "@msa/coding-agent/index.types";

import type agentsTypes from "./agents.types.ts";
import type subagentTypesTypes from "./types.types.ts";

declare namespace dispatchTypes {
  interface DispatchContext {
    readonly ctx: codingAgentTypes.ExtensionContext;
    readonly signal: AbortSignal | undefined;
    readonly onUpdate: subagentTypesTypes.OnUpdateCallback | undefined;
    readonly agents: agentsTypes.AgentConfig[];
    readonly dispatchDefaults: subagentTypesTypes.DispatchDefaults;
    readonly projectAgentsDir: string | null;
    readonly makeDetails: (
      mode: subagentTypesTypes.SubagentDetails["mode"],
    ) => (results: subagentTypesTypes.SingleResult[]) => subagentTypesTypes.SubagentDetails;
  }

  interface SubagentParamsValue {
    agent?: string | undefined;
    task?: string | undefined;
    tasks?: { agent: string; task: string; cwd?: string | undefined }[] | undefined;
    chain?: { agent: string; task: string; cwd?: string | undefined }[] | undefined;
    cwd?: string | undefined;
  }
}

export type { dispatchTypes as default };
