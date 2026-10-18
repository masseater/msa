import type { AutocompleteItem } from "@msa/tui";
import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../../core/awaiting.ts";
import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import { toDate } from "../../core/platform.ts";
import type { AccountKind } from "../accounts/kind.ts";
import {
  addAccount,
  authStatus,
  blockOf,
  describeLogin,
  clearBlocks,
  loadAccounts,
  loginAccount,
  logoutAccount,
  preferAccount,
  removeAccount,
  setAutoRotation,
  withAuthStatus,
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

function describeAccount(
  entry: Awaited<ReturnType<typeof withAuthStatus>>[number],
  index: number,
): string {
  const { account, status } = entry;
  const auth =
    account.configDir !== undefined && account.configDir !== ""
      ? `configDir ${account.configDir}`
      : account.tokenCommand !== undefined && account.tokenCommand !== ""
        ? "tokenCommand"
        : "msa environment";
  const loginText =
    describeLogin(status) ||
    `not logged in${status.detail !== undefined && status.detail !== "" ? ` (${status.detail})` : ""}`;
  const block = blockOf(account);
  const state =
    block === undefined
      ? "available"
      : `blocked until ${toDate(block.until).toLocaleString()} (${block.reason})`;
  return `${index + 1}. ${account.name}  ${auth}  ${loginText}  ${state}${account.auto === false ? "  (not in rotation)" : ""}`;
}

function describeAccounts(): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const entries = yield* awaited(withAuthStatus(loadAccounts()));
      return entries.map(describeAccount).join("\n");
    }),
  );
}

function login(account: Account, ctx: ExtensionCommandContext): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      if (!ctx.hasUI) throw new Error("Signing in needs the interactive UI");
      yield* awaited(
        loginAccount(account, {
          askCode: (url, signal) => {
            ctx.ui.notify(`Sign in to Claude for "${account.name}":\n${url}`, "info");
            return ctx.ui.input(`Paste the code for "${account.name}"`, "code", { signal });
          },
        }),
      );
      const status = yield* awaited(authStatus(account));
      ctx.ui.notify(
        `"${account.name}" ${status.loggedIn ? `logged in${status.email !== undefined && status.email !== "" ? ` as ${status.email}` : ""}` : "is still not logged in"}`,
        status.loggedIn ? "info" : "warning",
      );
    }),
  );
}

function named(name: string | undefined): Account {
  if (name === undefined || name === "") throw new Error("Give an account name");
  const account = loadAccounts().find((candidate) => candidate.name === name);
  if (account === undefined) throw new Error(`No Claude account named "${name}"`);
  return account;
}

function* runAddAccount(
  name: string | undefined,
  rest: string[],
  ctx: ExtensionCommandContext,
): Generator<Effect.Effect<unknown>, void, unknown> {
  if (name === undefined || name === "")
    throw new Error(`Usage: /accounts claude ${ACTIONS["add"]}`);
  const account = addAccount(name, rest.join(" ") || undefined);
  if (account.tokenCommand !== undefined && account.tokenCommand !== "") return;
  yield* awaited(
    login(account, ctx).catch((error: Error) => ctx.ui.notify(error.message, "warning")),
  );
}

function* runRemoveAccount(
  name: string | undefined,
  ctx: ExtensionCommandContext,
): Generator<Effect.Effect<unknown>, boolean, unknown> {
  named(name);
  if (
    ctx.hasUI &&
    !(yield* awaited(ctx.ui.confirm("Remove Claude account", `Forget "${name}" and its login?`)))
  )
    return false;
  removeAccount(name!);
  return true;
}

function* run(
  args: string,
  ctx: ExtensionCommandContext,
): Generator<Effect.Effect<unknown>, void, unknown> {
  const [action = "", name, ...rest] = args.trim().split(/\s+/u).filter(Boolean);
  const before = loadAccounts().length;
  switch (action) {
    case "":
      break;
    case "add":
      yield* runAddAccount(name, rest, ctx);
      break;
    case "login":
      yield* awaited(login(named(name), ctx));
      break;
    case "logout":
      yield* awaited(logoutAccount(named(name)));
      break;
    case "remove":
      if (!(yield* runRemoveAccount(name, ctx))) return;
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
  ctx.ui.notify(yield* awaited(describeAccounts()), "info");
  if (loadAccounts().length !== before) yield* awaited(ctx.reload());
}

function claudeAccountsRun(args: string, ctx: ExtensionCommandContext): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      yield* run(args, ctx);
    }),
  );
}

function completions(prefix: string): AutocompleteItem[] | null {
  const [action = "", name, ...rest] = prefix.trimStart().split(/\s+/u);
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
  run: claudeAccountsRun,
  complete: completions,
};
