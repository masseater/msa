import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import type accountsTypes from "../accounts.types.ts";
import platform from "../platform/index.ts";
import claudeAccountsModule from "./claude-accounts.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";

const { toDate } = platform;
const {
  addAccount,
  authStatus,
  blockOf,
  cachedAccounts,
  clearBlocks,
  describeLogin,
  loadAccounts,
  loginAccount,
  logoutAccount,
  preferAccount,
  removeAccount,
  setAutoRotation,
  withAuthStatus,
} = claudeAccountsModule;

type Account = claudeAccountsTypes.Account;
type Context = accountsTypes.AccountsContext;

const ACTIONS: Record<string, string> = {
  add: "add <name> [tokenCommand]: add an account and sign it in",
  clear: "clear: forget usage-limit blocks",
  disable: "disable <name>: keep out of the claude-subs rotation",
  enable: "enable <name>: include in the claude-subs rotation",
  login: "login <name>: sign an account in to Claude",
  logout: "logout <name>: sign an account out",
  remove: "remove <name>: forget an account",
  use: "use <name>: try this account first",
};

const present = (value: string | undefined): value is string => value !== undefined && value !== "";

function authLabel(account: Account): string {
  if (present(account.configDir)) return `configDir ${account.configDir}`;
  return present(account.tokenCommand) ? "tokenCommand" : "msa environment";
}

function describeAccount(
  account: Account,
  status: claudeAccountsTypes.AuthStatus,
  block: claudeAccountsTypes.AccountBlock | undefined,
  index: number,
) {
  const loggedIn = describeLogin(status);
  const loginText =
    loggedIn === ""
      ? `not logged in${present(status.detail) ? ` (${status.detail})` : ""}`
      : loggedIn;
  const state =
    block === undefined
      ? "available"
      : `blocked until ${toDate(block.until).toLocaleString()} (${block.reason})`;
  const rotation = account.auto === false ? "  (not in rotation)" : "";
  return `${index + 1}. ${account.name}  ${authLabel(account)}  ${loginText}  ${state}${rotation}`;
}

const describeAccounts = (): Promise<string> =>
  loadAccounts()
    .then(withAuthStatus)
    .then((rows) =>
      Promise.all(
        rows.map(({ account, status }, index) =>
          blockOf(account).then((block) => describeAccount(account, status, block, index)),
        ),
      ),
    )
    .then((lines) => lines.join("\n"));

const login = (account: Account, ctx: Context) =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      loginAccount(account, {
        askCode: (url, signal) => {
          ctx.ui.notify(`Sign in to Claude for "${account.name}":\n${url}`, "info");
          return ctx.ui.input(`Paste the code for "${account.name}"`, "code", { signal });
        },
      }),
    );
    const status = yield* Effect.promise(() => authStatus(account));
    const email = present(status.email) ? ` as ${status.email}` : "";
    ctx.ui.notify(
      `"${account.name}" ${status.loggedIn ? `logged in${email}` : "is still not logged in"}`,
      status.loggedIn ? "info" : "warning",
    );
  });

function named(name: string | undefined): Effect.Effect<Account> {
  return Effect.gen(function* () {
    if (!present(name)) throw new Error("Give an account name");
    const accounts = yield* Effect.promise(loadAccounts);
    const account = accounts.find((candidate) => candidate.name === name);
    if (account === undefined) throw new Error(`No Claude account named "${name}"`);
    return account;
  });
}

const addAndLogin = (name: string | undefined, rest: string[], ctx: Context) =>
  Effect.gen(function* () {
    if (!present(name)) throw new Error(`Usage: /accounts claude ${ACTIONS["add"]}`);
    const tokenCommand = rest.join(" ");
    const account = yield* Effect.promise(() =>
      addAccount(name, tokenCommand === "" ? undefined : tokenCommand),
    );
    if (present(account.tokenCommand)) return;
    yield* login(account, ctx).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => ctx.ui.notify((error as Error).message, "warning")),
      ),
    );
  });

const removeNamed = (name: string | undefined, _rest: string[], ctx: Context) =>
  Effect.gen(function* () {
    const account = yield* named(name);
    const confirmed = yield* Effect.promise(() =>
      ctx.ui.confirm("Remove Claude account", `Forget "${account.name}" and its login?`),
    );
    if (confirmed) yield* Effect.promise(() => removeAccount(account.name));
    return confirmed;
  });

type Handler = (name: string | undefined, rest: string[], ctx: Context) => Effect.Effect<unknown>;

const HANDLERS: Record<string, Handler> = {
  "": () => Effect.void,
  add: addAndLogin,
  clear: () => Effect.promise(clearBlocks),
  disable: (name) =>
    Effect.flatMap(named(name), (account) =>
      Effect.promise(() => setAutoRotation(account.name, false)),
    ),
  enable: (name) =>
    Effect.flatMap(named(name), (account) =>
      Effect.promise(() => setAutoRotation(account.name, true)),
    ),
  login: (name, _rest, ctx) => Effect.flatMap(named(name), (account) => login(account, ctx)),
  logout: (name) =>
    Effect.flatMap(named(name), (account) => Effect.promise(() => logoutAccount(account))),
  remove: removeNamed,
  use: (name) =>
    Effect.flatMap(named(name), (account) => Effect.promise(() => preferAccount(account.name))),
};

const run = (args: string, ctx: Context): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const [action = "", name, ...rest] = args.trim().split(/\s+/u).filter(Boolean);
      const handler = Object.hasOwn(HANDLERS, action) ? HANDLERS[action] : undefined;
      if (handler === undefined)
        throw new Error(`Unknown action "${action}".\n${Object.values(ACTIONS).join("\n")}`);
      const before = (yield* Effect.promise(loadAccounts)).length;
      const outcome = yield* handler(name, rest, ctx);
      if (outcome === false) return;
      const description = yield* Effect.promise(describeAccounts);
      ctx.ui.notify(description, "info");
      if ((yield* Effect.promise(loadAccounts)).length !== before)
        yield* Effect.promise(() => ctx.refreshProviders());
    }),
  );

function completions(prefix: string): tuiTypes.AutocompleteItem[] | null {
  const [action = "", name, ...rest] = prefix.trimStart().split(/\s+/u);
  if (name === undefined) {
    return Object.entries(ACTIONS)
      .filter(([item]) => item.startsWith(action))
      .map(([item, description]) => ({ description, label: item, value: `${item} ` }));
  }
  if (rest.length > 0 || action === "add" || action === "clear" || !(action in ACTIONS))
    return null;
  return cachedAccounts()
    .filter((account) => account.name.startsWith(name))
    .map((account) => ({ label: account.name, value: `${action} ${account.name}` }));
}

const claudeAccounts: accountsTypes.AccountKind = {
  complete: completions,
  describe: describeAccounts,
  description: "Claude Code accounts the claude-subs provider rotates through",
  name: "claude",
  run,
};

const claudeAccountKind = {
  claudeAccounts,
};

export default claudeAccountKind;
