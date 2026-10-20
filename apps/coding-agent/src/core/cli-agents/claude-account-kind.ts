import type tuiTypes from "@msa/tui/index.types";

import type { AccountKind, AccountsContext } from "../accounts.ts";
import {
  type Account,
  addAccount,
  authStatus,
  blockOf,
  clearBlocks,
  describeLogin,
  loadAccounts,
  loginAccount,
  logoutAccount,
  preferAccount,
  removeAccount,
  setAutoRotation,
  withAuthStatus,
} from "./claude-accounts.ts";

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

async function describeAccounts(): Promise<string> {
  return (await withAuthStatus(loadAccounts()))
    .map(({ account, status }, index) => {
      const auth = account.configDir
        ? `configDir ${account.configDir}`
        : account.tokenCommand
          ? "tokenCommand"
          : "msa environment";
      const loginText =
        describeLogin(status) || `not logged in${status.detail ? ` (${status.detail})` : ""}`;
      const block = blockOf(account);
      const state = block
        ? `blocked until ${new Date(block.until).toLocaleString()} (${block.reason})`
        : "available";
      return `${index + 1}. ${account.name}  ${auth}  ${loginText}  ${state}${account.auto === false ? "  (not in rotation)" : ""}`;
    })
    .join("\n");
}

async function login(account: Account, ctx: AccountsContext): Promise<void> {
  await loginAccount(account, {
    askCode: (url, signal) => {
      ctx.ui.notify(`Sign in to Claude for "${account.name}":\n${url}`, "info");
      return ctx.ui.input(`Paste the code for "${account.name}"`, "code", { signal });
    },
  });
  const status = await authStatus(account);
  ctx.ui.notify(
    `"${account.name}" ${status.loggedIn ? `logged in${status.email ? ` as ${status.email}` : ""}` : "is still not logged in"}`,
    status.loggedIn ? "info" : "warning",
  );
}

function named(name: string | undefined): Account {
  if (!name) throw new Error("Give an account name");
  const account = loadAccounts().find((candidate) => candidate.name === name);
  if (!account) throw new Error(`No Claude account named "${name}"`);
  return account;
}

async function run(args: string, ctx: AccountsContext): Promise<void> {
  const [action = "", name, ...rest] = args.trim().split(/\s+/).filter(Boolean);
  const before = loadAccounts().length;
  switch (action) {
    case "":
      break;
    case "add": {
      if (!name) throw new Error(`Usage: /accounts claude ${ACTIONS["add"]}`);
      const account = addAccount(name, rest.join(" ") || undefined);

      if (!account.tokenCommand)
        await login(account, ctx).catch((error: Error) => ctx.ui.notify(error.message, "warning"));
      break;
    }
    case "login":
      await login(named(name), ctx);
      break;
    case "logout":
      await logoutAccount(named(name));
      break;
    case "remove":
      named(name);
      if (!(await ctx.ui.confirm("Remove Claude account", `Forget "${name}" and its login?`)))
        return;
      removeAccount(name!);
      break;
    case "use":
      preferAccount(named(name).name);
      break;
    case "enable":
    case "disable":
      setAutoRotation(named(name).name, action === "enable");
      break;
    case "clear":
      clearBlocks();
      break;
    default:
      throw new Error(`Unknown action "${action}".\n${Object.values(ACTIONS).join("\n")}`);
  }
  ctx.ui.notify(await describeAccounts(), "info");

  if (loadAccounts().length !== before) await ctx.refreshProviders();
}

function completions(prefix: string): tuiTypes.AutocompleteItem[] | null {
  const [action = "", name, ...rest] = prefix.trimStart().split(/\s+/);
  if (name === undefined) {
    return Object.entries(ACTIONS)
      .filter(([item]) => item.startsWith(action))
      .map(([item, description]) => ({ description, label: item, value: `${item} ` }));
  }
  if (rest.length > 0 || action === "add" || action === "clear" || !(action in ACTIONS))
    return null;
  return loadAccounts()
    .filter((account) => account.name.startsWith(name))
    .map((account) => ({ label: account.name, value: `${action} ${account.name}` }));
}

export const claudeAccounts: AccountKind = {
  complete: completions,
  describe: describeAccounts,
  description: "Claude Code accounts the claude-subs provider rotates through",
  name: "claude",
  run,
};
