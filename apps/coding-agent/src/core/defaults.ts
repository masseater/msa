import type agentTypes from "@msa/agent-core/index.types";

export const DEFAULT_THINKING_LEVEL: agentTypes.ThinkingLevel = "medium";
export const THINKING_LEVEL_OPTIONS: readonly agentTypes.ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
