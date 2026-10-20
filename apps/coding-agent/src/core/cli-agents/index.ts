import type aiTypes from "@msa/ai/index.types";

import { claudeCodeProviders } from "./claude-code.ts";
import { openCodeProvider } from "./opencode.ts";

export function cliAgentProviders(): aiTypes.Provider[] {
  return [openCodeProvider(), ...claudeCodeProviders()];
}

export function isCliAgentProvider(providerId: string): boolean {
  return cliAgentProviders().some((provider) => provider.id === providerId);
}
