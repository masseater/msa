import type { AgentSession, CreateAgentSessionOptions } from "@msa/coding-agent";
import type { Effect } from "effect";
import type { JsonValue } from "vitest-evals/harness";

import type { MsaCodingAgentModelSelection } from "./model-selection.ts";

export type MsaCodingAgentInput =
  | string
  | Array<{ type: "prompt"; content: string } | { type: "reload" }>;

export type MsaCodingAgentHarnessOptions = {
  name?: string;
  model?: MsaCodingAgentModelSelection;
  noTools?: CreateAgentSessionOptions["noTools"];
  tools?: CreateAgentSessionOptions["tools"];
  customTools?: CreateAgentSessionOptions["customTools"];
  workspaceFiles?: Readonly<Record<string, string>>;
  transformSystemPrompt?: (defaultPrompt: string) => string;
  expectedMsaDocumentation?: boolean;
};

export type MsaCodingAgentHarnessWithOutput<TOutput extends JsonValue> =
  MsaCodingAgentHarnessOptions & {
    output: (args: {
      response: string;
      session: AgentSession;
      systemPrompt: string;
      agentDir: string;
    }) => Effect.Effect<TOutput>;
  };
