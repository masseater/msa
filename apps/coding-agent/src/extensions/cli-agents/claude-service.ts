/**
 * Claude Code as an external service, so `/login` signs its accounts in to Claude. `/accounts claude`
 * manages the same accounts with more actions.
 */
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { ExternalService } from "../../core/external-services.ts";
import {
  type Account,
  addAccount,
  authStatus,
  claudeExecutable,
  loadAccounts,
  loginAccount,
  logoutAccount,
} from "./claude-accounts.ts";

const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";
const NEW_ACCOUNT = "Add a new account";

/** Accounts that sign in with Claude Code's own login rather than a tokenCommand. */
function loginAccounts(): Account[] {
  return loadAccounts().filter((account) => account.configDir || !account.tokenCommand);
}

async function withStatus(accounts: Account[]) {
  const statuses = await Promise.all(accounts.map((account) => authStatus(account)));
  return accounts.map((account, index) => {
    const status = statuses[index]!;
    const state = status.loggedIn ? `logged in${status.email ? ` as ${status.email}` : ""}` : "";
    return {
      account,
      loggedIn: status.loggedIn,
      label: state ? `${account.name} (${state})` : account.name,
    };
  });
}

export const claudeCodeService: ExternalService = {
  id: "claude-code",
  name: "Claude Code",
  purpose: "Claude models through the claude-code provider",
  async status() {
    const executable = claudeExecutable();
    // CLAUDE_BIN names the binary without checking it exists.
    if (!executable || (isAbsolute(executable) && !existsSync(executable))) {
      return { installed: false, install: INSTALL_COMMAND };
    }
    const accounts = await withStatus(loginAccounts());
    return { installed: true, signedIn: accounts.some((entry) => entry.loggedIn) };
  },
  async login(interaction) {
    const accounts = await withStatus(loginAccounts());
    let account: Account | undefined = accounts[0]?.account;
    if (accounts.length !== 1) {
      const choice = await interaction.select("Sign in which Claude account?", [
        ...accounts.map((entry) => entry.label),
        NEW_ACCOUNT,
      ]);
      account =
        choice === NEW_ACCOUNT
          ? addAccount((await interaction.prompt("Name for the new account", "work")).trim())
          : accounts.find((entry) => entry.label === choice)?.account;
    }
    if (!account) throw new Error("No Claude account to sign in");
    await loginAccount(account, {
      askCode: (url) => {
        interaction.showPage({ url });
        return interaction.prompt("Paste the code the page shows");
      },
    });
    if (!(await authStatus(account)).loggedIn) {
      throw new Error(`"${account.name}" is still not logged in`);
    }
  },
  async logout(interaction) {
    const accounts = (await withStatus(loginAccounts())).filter((entry) => entry.loggedIn);
    const choice =
      accounts.length === 1
        ? accounts[0]!.label
        : await interaction.select(
            "Sign out which Claude account?",
            accounts.map((entry) => entry.label),
          );
    const account = accounts.find((entry) => entry.label === choice)?.account;
    if (account) await logoutAccount(account);
  },
};
