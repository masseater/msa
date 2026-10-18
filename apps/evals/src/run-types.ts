import type { AgentSession, InlineExtension, SessionManager } from "@msa/coding-agent";
import type {
  JsonValue,
  SimpleHarnessResult,
  TranscriptEvent,
  UsageSummary,
} from "vitest-evals/harness";

import type {
  MsaCodingAgentHarnessOptions,
  MsaCodingAgentHarnessWithOutput,
} from "./harness-types.ts";
import type { MsaCodingAgentModelSelection } from "./model-selection.ts";
import type { SandboxIdentity } from "./sandbox.ts";

export type MsaRunDiagnostics = {
  events: TranscriptEvent[];
  metadata: Record<string, unknown>;
  usage: UsageSummary;
};

export type Options<TOutput extends JsonValue> =
  | MsaCodingAgentHarnessOptions
  | MsaCodingAgentHarnessWithOutput<TOutput>;

export type RunState<TOutput extends JsonValue> = {
  forcedSystemPrompt: string | undefined;
  sessionManager: SessionManager | undefined;
  session: AgentSession | undefined;
  result: SimpleHarnessResult<string | TOutput> | undefined;
  diagnostics: MsaRunDiagnostics | undefined;
  hiddenCredential: { name: string; value: string } | undefined;
};

export type HostSelection = {
  selection: MsaCodingAgentModelSelection;
  authPath: string;
  sandboxIdentity: SandboxIdentity | undefined;
};

export type RunPaths = { root: string; workspace: string; isolatedHome: string; agentDir: string };

export type AgentRunContext = {
  host: HostSelection;
  paths: RunPaths;
  extensionFactories: InlineExtension[];
};
