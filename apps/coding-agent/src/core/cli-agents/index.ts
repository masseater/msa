import type { Provider } from "@msa/ai";

import { claudeCodeProviders } from "./claude-code.ts";
import { openCodeProvider } from "./opencode.ts";

export function cliAgentProviders(): Provider[] {
  return [openCodeProvider(), ...claudeCodeProviders()];
}

export function isCliAgentProvider(providerId: string): boolean {
  return cliAgentProviders().some((provider) => provider.id === providerId);
}
