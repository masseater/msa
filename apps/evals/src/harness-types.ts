import type codingAgentTypes from "@msa/coding-agent/index.types";
import type { Effect } from "effect";
import type { JsonValue } from "vitest-evals/harness";

import type modelSelectionTypes from "./model-selection.types.ts";

declare namespace harnessTypesTypes {
  type MsaCodingAgentInput =
    | string
    | Array<{ type: "prompt"; content: string } | { type: "reload" }>;

  type MsaCodingAgentHarnessOptions = {
    name?: string;
    model?: modelSelectionTypes.MsaCodingAgentModelSelection;
    noTools?: codingAgentTypes.CreateAgentSessionOptions["noTools"];
    tools?: codingAgentTypes.CreateAgentSessionOptions["tools"];
    customTools?: codingAgentTypes.CreateAgentSessionOptions["customTools"];
    workspaceFiles?: Readonly<Record<string, string>>;
    transformSystemPrompt?: (defaultPrompt: string) => string;
    expectedMsaDocumentation?: boolean;
  };

  type MsaCodingAgentHarnessWithOutput<TOutput extends JsonValue> = MsaCodingAgentHarnessOptions & {
    output: (args: {
      response: string;
      session: codingAgentTypes.AgentSession;
      systemPrompt: string;
      agentDir: string;
    }) => Effect.Effect<TOutput>;
  };
}

export type { harnessTypesTypes as default };
