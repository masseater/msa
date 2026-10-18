import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../../core/awaiting.ts";
import type { ExternalService, ServiceLoginInteraction } from "../../core/external-services.ts";
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
  return loadAccounts().filter(
    (account) =>
      account.configDir || account.tokenCommand === undefined || account.tokenCommand === "",
  );
}

function withLabels(accounts: Account[]) {
  return Effect.runPromise(
    awaiting(function* () {
      return (yield* awaited(withAuthStatus(accounts))).map(({ account, status }) => {
        const state = describeLogin(status);
        return {
          account,
          loggedIn: status.loggedIn,
          label: state === "" ? account.name : `${account.name} (${state})`,
        };
      });
    }),
  );
}

function chooseAccount(
  interaction: ServiceLoginInteraction,
  accounts: Awaited<ReturnType<typeof withLabels>>,
): Promise<Account | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      if (accounts.length === 1) return accounts[0]!.account;
      const choice = yield* awaited(
        interaction.select("Sign in which Claude account?", [
          ...accounts.map((entry) => entry.label),
          NEW_ACCOUNT,
        ]),
      );
      if (choice !== NEW_ACCOUNT) return accounts.find((entry) => entry.label === choice)?.account;
      return addAccount(
        (yield* awaited(interaction.prompt("Name for the new account", "work"))).trim(),
      );
    }),
  );
}

export const claudeCodeService: ExternalService = {
  id: "claude-code",
  name: "Claude Code",
  purpose: "Claude models through the claude-code provider",
  status() {
    return Effect.runPromise(
      awaiting(function* () {
        const executable = claudeExecutable();
        if (executable === undefined || executable === "")
          return { installed: false, install: INSTALL_COMMAND };
        const accounts = yield* awaited(withLabels(loginAccounts()));
        return { installed: true, signedIn: accounts.some((entry) => entry.loggedIn) };
      }),
    );
  },
  login(interaction) {
    return Effect.runPromise(
      awaiting(function* () {
        const account = yield* awaited(
          chooseAccount(interaction, yield* awaited(withLabels(loginAccounts()))),
        );
        if (account === undefined) throw new Error("No Claude account to sign in");
        yield* awaited(
          loginAccount(account, {
            askCode: (url) => {
              interaction.showPage({ url });
              return interaction.prompt("Paste the code the page shows");
            },
          }),
        );
        if (!(yield* awaited(authStatus(account))).loggedIn) {
          throw new Error(`"${account.name}" is still not logged in`);
        }
      }),
    );
  },
  logout(interaction) {
    return Effect.runPromise(
      awaiting(function* () {
        const accounts = (yield* awaited(withLabels(loginAccounts()))).filter(
          (entry) => entry.loggedIn,
        );
        const choice =
          accounts.length === 1
            ? accounts[0]!.label
            : yield* awaited(
                interaction.select(
                  "Sign out which Claude account?",
                  accounts.map((entry) => entry.label),
                ),
              );
        const account = accounts.find((entry) => entry.label === choice)?.account;
        if (account !== undefined) yield* awaited(logoutAccount(account));
      }),
    );
  },
};
