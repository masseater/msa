/**
 * Other coding-agent CLIs as msa providers: selecting one of their models runs
 * that CLI (with its own tools) for each request and streams its reply back.
 */
import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { registerClaudeAccountsCommand } from "./accounts-command.ts";
import { registerClaudeCode } from "./claude-code.ts";
import { registerOpenCode } from "./opencode.ts";

export default function cliAgentsExtension(msa: ExtensionAPI): void {
  registerOpenCode(msa);
  registerClaudeCode(msa);
  registerClaudeAccountsCommand(msa);
}
