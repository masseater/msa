/**
 * Other coding agents as msa providers: selecting one of their models runs that
 * agent under its own login for each request and streams its reply back.
 */
import type { Provider } from "@msa/ai";

import { claudeCodeProviders } from "./claude-code.ts";
import { openCodeProvider } from "./opencode.ts";

/** Read on every model refresh, so `claude-subs-<account>` follows the account list. */
export function cliAgentProviders(): Provider[] {
  return [openCodeProvider(), ...claudeCodeProviders()];
}

/** Whether requests to `providerId` run another agent, which adds its own prompt and tools. */
export function isCliAgentProvider(providerId: string): boolean {
  return cliAgentProviders().some((provider) => provider.id === providerId);
}
