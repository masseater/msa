/**
 * `/accounts claude`: list the Claude accounts the claude-code provider rotates
 * through, add and remove them, sign them in and out, and pick their order.
 * Changes that add or drop a `claude-code-<account>` provider reload msa.
 */
import type { AutocompleteItem } from "@msa/tui";

import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import type { AccountKind } from "../accounts/kind.ts";
import {
  addAccount,
  authStatus,
  blockOf,
  clearBlocks,
  loadAccounts,
  loginAccount,
  logoutAccount,
  preferAccount,
  removeAccount,
  setAutoRotation,
  type Account,
} from "./claude-accounts.ts";

const ACTIONS: Record<string, string> = {
  add: "add <name> [tokenCommand]: add an account and sign it in",
  login: "login <name>: sign an account in to Claude",
  logout: "logout <name>: sign an account out",
  remove: "remove <name>: forget an account",
  use: "use <name>: try this account first",
  enable: "enable <name>: include in the claude-code rotation",
  disable: "disable <name>: keep out of the claude-code rotation",
  clear: "clear: forget usage-limit blocks",
};

async function describeAccounts(): Promise<string> {
  const accounts = loadAccounts();
  const statuses = await Promise.all(accounts.map((account) => authStatus(account)));
  return accounts
    .map((account, index) => {
      const status = statuses[index]!;
      const auth = account.configDir
        ? `configDir ${account.configDir}`
        : account.tokenCommand
          ? "tokenCommand"
          : "msa environment";
      const login = status.loggedIn
        ? `logged in${status.email ? ` as ${status.email}` : ""}`
        : `not logged in${status.detail ? ` (${status.detail})` : ""}`;
      const block = blockOf(account);
      const state = block
        ? `blocked until ${new Date(block.until).toLocaleString()} (${block.reason})`
        : "available";
      return `${index + 1}. ${account.name}  ${auth}  ${login}  ${state}${account.auto === false ? "  (not in rotation)" : ""}`;
    })
    .join("\n");
}

async function login(account: Account, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) throw new Error("Signing in needs the interactive UI");
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

async function run(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const [action = "", name, ...rest] = args.trim().split(/\s+/).filter(Boolean);
  const before = loadAccounts().length;
  switch (action) {
    case "":
      break;
    case "add": {
      if (!name) throw new Error(`Usage: /accounts claude ${ACTIONS["add"]}`);
      const account = addAccount(name, rest.join(" ") || undefined);
      // The account stays when signing in fails; `login` retries it.
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
      if (
        ctx.hasUI &&
        !(await ctx.ui.confirm("Remove Claude account", `Forget "${name}" and its login?`))
      )
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
  // Adding or removing an account adds or drops claude-code-<account> providers.
  if (loadAccounts().length !== before) await ctx.reload();
}

function completions(prefix: string): AutocompleteItem[] | null {
  const [action = "", name, ...rest] = prefix.trimStart().split(/\s+/);
  if (name === undefined) {
    return Object.entries(ACTIONS)
      .filter(([item]) => item.startsWith(action))
      .map(([item, description]) => ({ value: `${item} `, label: item, description }));
  }
  if (rest.length > 0 || action === "add" || action === "clear" || !(action in ACTIONS))
    return null;
  return loadAccounts()
    .filter((account) => account.name.startsWith(name))
    .map((account) => ({ value: `${action} ${account.name}`, label: account.name }));
}

export const claudeAccounts: AccountKind = {
  name: "claude",
  description: "Claude Code accounts the claude-code provider rotates through",
  describe: describeAccounts,
  run,
  complete: completions,
};
