import type agentTypes from "@msa/agent-core/index.types";

const DEFAULT_THINKING_LEVEL: agentTypes.ThinkingLevel = "medium";
const THINKING_LEVEL_OPTIONS: readonly agentTypes.ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const defaults = {
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVEL_OPTIONS,
};

export default defaults;
