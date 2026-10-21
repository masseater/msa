import { Effect } from "effect";

import type externalServicesTypes from "../external-services.types.ts";
import claudeAccounts from "./claude-accounts.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";

const {
  addAccount,
  authStatus,
  claudeExecutable,
  describeLogin,
  loadAccounts,
  loginAccount,
  logoutAccount,
  withAuthStatus,
} = claudeAccounts;

const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";
const NEW_ACCOUNT = "Add a new account";

type Interaction = externalServicesTypes.ServiceLoginInteraction;

interface LabeledAccount {
  readonly account: claudeAccountsTypes.Account;
  readonly label: string;
  readonly loggedIn: boolean;
}

const present = (value: string | undefined) => value !== undefined && value !== "";

function loginAccounts(): Promise<claudeAccountsTypes.Account[]> {
  return loadAccounts().then((accounts) =>
    accounts.filter((account) => present(account.configDir) || !present(account.tokenCommand)),
  );
}

const withLabels = (accounts: claudeAccountsTypes.Account[]): Promise<LabeledAccount[]> =>
  withAuthStatus(accounts).then((rows) =>
    rows.map(({ account, status }) => {
      const state = describeLogin(status);
      return {
        account,
        label: state === "" ? account.name : `${account.name} (${state})`,
        loggedIn: status.loggedIn,
      };
    }),
  );

const chooseAccount = (interaction: Interaction, accounts: LabeledAccount[]) =>
  Effect.gen(function* () {
    if (accounts.length === 1) return accounts[0]!.account;
    const choice = yield* Effect.promise(() =>
      interaction.select("Sign in which Claude account?", [
        ...accounts.map((entry) => entry.label),
        NEW_ACCOUNT,
      ]),
    );
    if (choice !== NEW_ACCOUNT) return accounts.find((entry) => entry.label === choice)?.account;
    const name = yield* Effect.promise(() =>
      interaction.prompt("Name for the new account", "work"),
    );
    return yield* Effect.promise(() => addAccount(name.trim()));
  });

const login = (interaction: Interaction) =>
  Effect.gen(function* () {
    const labeled = yield* Effect.promise(() => loginAccounts().then(withLabels));
    const account = yield* chooseAccount(interaction, labeled);
    if (account === undefined) throw new Error("No Claude account to sign in");
    yield* Effect.promise(() =>
      loginAccount(account, {
        askCode: (url) => {
          interaction.showPage({ url });
          return interaction.prompt("Paste the code the page shows");
        },
      }),
    );
    const status = yield* Effect.promise(() => authStatus(account));
    if (!status.loggedIn) throw new Error(`"${account.name}" is still not logged in`);
  });

const logout = (interaction: externalServicesTypes.ServiceLogoutInteraction) =>
  Effect.gen(function* () {
    const labeled = yield* Effect.promise(() => loginAccounts().then(withLabels));
    const accounts = labeled.filter((entry) => entry.loggedIn);
    const choice =
      accounts.length === 1
        ? accounts[0]!.label
        : yield* Effect.promise(() =>
            interaction.select(
              "Sign out which Claude account?",
              accounts.map((entry) => entry.label),
            ),
          );
    const account = accounts.find((entry) => entry.label === choice)?.account;
    if (account !== undefined) yield* Effect.promise(() => logoutAccount(account));
  });

const status = (): Promise<externalServicesTypes.ServiceStatus> => {
  if ((claudeExecutable() ?? "") === "")
    return Promise.resolve({ install: INSTALL_COMMAND, installed: false });
  return loginAccounts()
    .then(withLabels)
    .then((accounts) => ({
      installed: true,
      signedIn: accounts.some((entry) => entry.loggedIn),
    }));
};

const claudeCodeService: externalServicesTypes.ExternalService = {
  id: "claude-code",
  login: (interaction) => Effect.runPromise(login(interaction)),
  logout: (interaction) => Effect.runPromise(logout(interaction)),
  name: "Claude Code",
  purpose: "Claude models through the claude-subs provider",
  status,
};

const claudeService = {
  claudeCodeService,
};

export default claudeService;
