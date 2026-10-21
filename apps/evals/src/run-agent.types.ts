import type { HarnessContext, JsonValue } from "vitest-evals/harness";

import type harnessTypesTypes from "./harness-types.ts";
import type runTypesTypes from "./run-types.ts";

declare namespace runAgentTypes {
  type AgentRunRequest<TOutput extends JsonValue> = {
    input: harnessTypesTypes.MsaCodingAgentInput;
    signal: AbortSignal | undefined;
    setArtifact: HarnessContext["setArtifact"];
    options: runTypesTypes.Options<TOutput>;
  };
}

export type { runAgentTypes as default };
