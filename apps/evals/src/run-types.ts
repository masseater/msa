import type codingAgentTypes from "@msa/coding-agent/index.types";
import type {
  JsonValue,
  SimpleHarnessResult,
  TranscriptEvent,
  UsageSummary,
} from "vitest-evals/harness";

import type harnessTypesTypes from "./harness-types.ts";
import type modelSelectionTypes from "./model-selection.types.ts";
import type sandboxTypes from "./sandbox.types.ts";

declare namespace runTypesTypes {
  type MsaRunDiagnostics = {
    events: TranscriptEvent[];
    metadata: Record<string, unknown>;
    usage: UsageSummary;
  };

  type Options<TOutput extends JsonValue> =
    | harnessTypesTypes.MsaCodingAgentHarnessOptions
    | harnessTypesTypes.MsaCodingAgentHarnessWithOutput<TOutput>;

  type RunState<TOutput extends JsonValue> = {
    forcedSystemPrompt: string | undefined;
    sessionManager: codingAgentTypes.SessionManager | undefined;
    session: codingAgentTypes.AgentSession | undefined;
    result: SimpleHarnessResult<string | TOutput> | undefined;
    diagnostics: MsaRunDiagnostics | undefined;
  };

  type HostSelection = {
    selection: modelSelectionTypes.MsaCodingAgentModelSelection;
    authPath: string;
    sandboxIdentity: sandboxTypes.SandboxIdentity | undefined;
  };

  type RunPaths = { root: string; workspace: string; agentDir: string };

  type AgentRunContext = {
    host: HostSelection;
    paths: RunPaths;
    extensionFactories: codingAgentTypes.InlineExtension[];
  };
}

export type { runTypesTypes as default };
