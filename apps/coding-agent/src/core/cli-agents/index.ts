/**
 * Other coding agents as msa providers: selecting one of their models runs that
 * agent under its own login for each request and streams its reply back.
 */
import type { Provider } from "@msa/ai";

import { claudeCodeProviders } from "./claude-code.ts";
import { openCodeProvider } from "./opencode.ts";

/** Read on every model refresh, so `claude-code-<account>` follows the account list. */
export function cliAgentProviders(): Provider[] {
  return [openCodeProvider(), ...claudeCodeProviders()];
}
