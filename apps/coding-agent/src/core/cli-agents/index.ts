import type aiTypes from "@msa/ai/index.types";

import claudeCode from "./claude-code.ts";
import opencode from "./opencode.ts";

const { openCodeProvider } = opencode;
const { claudeCodeProviders } = claudeCode;

function cliAgentProviders(): aiTypes.Provider[] {
  return [openCodeProvider(), ...claudeCodeProviders()];
}

function isCliAgentProvider(providerId: string): boolean {
  return cliAgentProviders().some((provider) => provider.id === providerId);
}

const cliAgents = {
  cliAgentProviders,
  isCliAgentProvider,
};

export default cliAgents;
