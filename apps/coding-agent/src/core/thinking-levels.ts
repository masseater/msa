import type agentTypes from "@msa/agent-core/index.types";

const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

function isValidThinkingLevel(level: string): level is agentTypes.ThinkingLevel {
  return VALID_THINKING_LEVELS.includes(level as agentTypes.ThinkingLevel);
}

const thinkingLevels = { VALID_THINKING_LEVELS, isValidThinkingLevel };

export default thinkingLevels;
