import type aiTypes from "@msa/ai/index.types";

import claudeAccounts from "./claude-accounts.ts";
import claudeCode from "./claude-code.ts";
import opencode from "./opencode.ts";

const { openCodeProvider } = opencode;
const { claudeCodeProviders } = claudeCode;

function cliAgentProviders(): aiTypes.Provider[] {
  return [openCodeProvider(), ...claudeCodeProviders()];
}

function refreshCliAgentAccounts(): Promise<void> {
  return claudeAccounts.loadAccounts().then(
    () => undefined,
    () => undefined,
  );
}

function isCliAgentProvider(providerId: string): boolean {
  return cliAgentProviders().some((provider) => provider.id === providerId);
}

const cliAgents = {
  cliAgentProviders,
  isCliAgentProvider,
  refreshCliAgentAccounts,
};

export default cliAgents;
