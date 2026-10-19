import type { ExternalService, ServiceLoginInteraction } from "../external-services.ts";
import {
  type Account,
  addAccount,
  authStatus,
  claudeExecutable,
  describeLogin,
  loadAccounts,
  loginAccount,
  logoutAccount,
  withAuthStatus,
} from "./claude-accounts.ts";

const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";
const NEW_ACCOUNT = "Add a new account";

function loginAccounts(): Account[] {
  return loadAccounts().filter((account) => account.configDir || !account.tokenCommand);
}

async function withLabels(accounts: Account[]) {
  return (await withAuthStatus(accounts)).map(({ account, status }) => {
    const state = describeLogin(status);
    return {
      account,
      loggedIn: status.loggedIn,
      label: state ? `${account.name} (${state})` : account.name,
    };
  });
}

async function chooseAccount(
  interaction: ServiceLoginInteraction,
  accounts: Awaited<ReturnType<typeof withLabels>>,
): Promise<Account | undefined> {
  if (accounts.length === 1) return accounts[0]!.account;
  const choice = await interaction.select("Sign in which Claude account?", [
    ...accounts.map((entry) => entry.label),
    NEW_ACCOUNT,
  ]);
  if (choice !== NEW_ACCOUNT) return accounts.find((entry) => entry.label === choice)?.account;
  return addAccount((await interaction.prompt("Name for the new account", "work")).trim());
}

export const claudeCodeService: ExternalService = {
  id: "claude-code",
  name: "Claude Code",
  purpose: "Claude models through the claude-subs provider",
  async status() {
    if (!claudeExecutable()) return { installed: false, install: INSTALL_COMMAND };
    const accounts = await withLabels(loginAccounts());
    return { installed: true, signedIn: accounts.some((entry) => entry.loggedIn) };
  },
  async login(interaction) {
    const account = await chooseAccount(interaction, await withLabels(loginAccounts()));
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
    const accounts = (await withLabels(loginAccounts())).filter((entry) => entry.loggedIn);
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
