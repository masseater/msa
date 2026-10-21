import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type agentsTypes from "./agents.types.ts";

declare namespace subagentTypesTypes {
  interface UsageStats {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    contextTokens: number;
    turns: number;
  }

  interface SingleResult {
    agent: string;
    agentSource: "user" | "project" | "unknown";
    task: string;
    exitCode: number;
    messages: aiTypes.Message[];
    stderr: string;
    usage: UsageStats;
    model?: string | undefined;
    stopReason?: string;
    errorMessage?: string;
    step?: number | undefined;
  }

  interface SubagentDetails {
    mode: "single" | "parallel" | "chain";
    agentScope: agentsTypes.AgentScope;
    projectAgentsDir: string | null;
    results: SingleResult[];
  }

  type OnUpdateCallback = (partial: {
    content: { type: "text"; text: string }[];
    details: SubagentDetails;
  }) => void;

  interface DispatchDefaults {
    model?: string | undefined;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
  }

  type DisplayItem =
    | { type: "text"; text: string }
    | { type: "toolCall"; name: string; args: Record<string, unknown> };
}

export type { subagentTypesTypes as default };
