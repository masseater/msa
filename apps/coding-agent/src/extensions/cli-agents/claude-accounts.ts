/**
 * Claude accounts the claude-code provider can run Claude Code under, and which
 * of them are currently blocked (usage limit, logged out, disabled org).
 *
 * <agent dir>/claude-code-accounts.json:
 *   { "accounts": [
 *       { "name": "main", "configDir": "~/.claude-main" },
 *       { "name": "token", "tokenCommand": "op read op://vault/claude/token" },
 *       { "name": "work", "tokenCommand": "...", "auto": false } ] }
 *
 * `configDir` uses Claude Code's own login in that config dir. `tokenCommand` is
 * a shell command that prints a `claude setup-token` token; the token is given
 * only to that account's Claude Code process. Without the file there is one
 * account, "default", that inherits msa's environment. `auto: false` keeps an
 * account out of the `claude-code` rotation; it is used only through its own
 * provider.
 *
 * `/accounts claude` edits the file; an account added there without a
 * tokenCommand gets its own config dir under <agent dir>/claude-accounts.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { SDKAssistantMessageError } from "@anthropic-ai/claude-agent-sdk";

import { expandTildePath, getAgentDir } from "../../config.ts";
import { envSnapshot, readEnv } from "../../core/process-env.ts";
import { spawnProcess, waitForChildProcess } from "../../utils/child-process.ts";
import { findExecutableOnPath } from "../../utils/shell.ts";

const configFile = () => join(getAgentDir(), "claude-code-accounts.json");
const managedDir = (name: string) => join(getAgentDir(), "claude-accounts", name);
const blocksFile = () => join(getAgentDir(), "state", "claude-code-blocks.json");
const FALLBACK_BLOCK_MS = 60 * 60_000;
const LOGGED_OUT_BLOCK_MS = 10 * 60_000;
const DISABLED_BLOCK_MS = 24 * 60 * 60_000;

export interface Account {
  name: string;
  configDir?: string;
  tokenCommand?: string;
  auto?: boolean;
}

interface Block {
  until: number;
  reason: string;
}

/** The accounts as written in the file, `~` unexpanded. */
function readAccounts(): Account[] {
  let raw: string;
  try {
    raw = readFileSync(configFile(), "utf8");
  } catch {
    return [{ name: "default" }];
  }
  const accounts = (JSON.parse(raw) as { accounts?: Account[] }).accounts ?? [];
  if (accounts.length === 0) throw new Error(`${configFile()} lists no accounts`);
  return accounts;
}

export function loadAccounts(): Account[] {
  return readAccounts().map((account) =>
    account.configDir ? { ...account, configDir: expandTildePath(account.configDir) } : account,
  );
}

/** Apply `change` to the file's account list; writing it makes the implicit "default" explicit. */
function editAccounts(change: (accounts: Account[]) => Account[]): void {
  const accounts = change(readAccounts());
  if (accounts.length === 0) throw new Error("At least one Claude account must remain");
  const file = configFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ accounts }, null, 2)}\n`);
}

function findAccount(accounts: Account[], name: string): Account {
  const account = accounts.find((candidate) => candidate.name === name);
  if (!account) throw new Error(`No Claude account named "${name}"`);
  return account;
}

/** Add an account. Without a tokenCommand it gets its own, not yet logged-in, config dir. */
export function addAccount(name: string, tokenCommand?: string): Account {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    throw new Error(`Account name "${name}" must be lowercase letters, digits, "-" or "_"`);
  }
  const account: Account = tokenCommand
    ? { name, tokenCommand }
    : { name, configDir: managedDir(name) };
  editAccounts((accounts) => {
    if (accounts.some((candidate) => candidate.name === name)) {
      throw new Error(`Claude account "${name}" already exists`);
    }
    return [...accounts, account];
  });
  return account;
}

/** Remove an account, and the config dir msa made for it. */
export function removeAccount(name: string): void {
  let removed: Account | undefined;
  editAccounts((accounts) => {
    removed = findAccount(accounts, name);
    return accounts.filter((candidate) => candidate !== removed);
  });
  if (removed?.configDir && expandTildePath(removed.configDir) === managedDir(name)) {
    rmSync(managedDir(name), { recursive: true, force: true });
  }
  const blocks = loadBlocks();
  delete blocks[name];
  saveBlocks(blocks);
}

/** Put an account first, so the `claude-code` rotation tries it before the others. */
export function preferAccount(name: string): void {
  editAccounts((accounts) => {
    const account = findAccount(accounts, name);
    return [account, ...accounts.filter((candidate) => candidate !== account)];
  });
}

export function setAutoRotation(name: string, auto: boolean): void {
  editAccounts((accounts) => {
    findAccount(accounts, name);
    return accounts.map((account) => {
      if (account.name !== name) return account;
      const { auto: _auto, ...rest } = account;
      return auto ? rest : { ...rest, auto: false };
    });
  });
}

/**
 * The user's installed `claude` (CLAUDE_BIN, else PATH). msa ships as a bundle
 * or a compiled binary, where the SDK cannot find the Claude Code binary it
 * carries; without `claude` the SDK's own lookup is the only option left.
 */
export function claudeExecutable(): string | undefined {
  return readEnv("CLAUDE_BIN")?.trim() || findExecutableOnPath("claude") || undefined;
}

const tokens = new Map<string, Promise<string>>();

async function runTokenCommand(command: string): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(readEnv("SHELL") || "/bin/sh", ["-c", command]));
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    throw new Error(`tokenCommand ${command}: ${stderr.split("\n").at(-1) || "failed"}`, {
      cause: error,
    });
  }
  const token = stdout.trim();
  if (!token) throw new Error(`tokenCommand ${command}: printed nothing`);
  return token;
}

/** Environment for this account's Claude Code process. */
export async function accountEnv(account: Account): Promise<Record<string, string>> {
  const env = { ...envSnapshot() } as Record<string, string>;
  delete env["CLAUDECODE"];
  if (account.configDir || account.tokenCommand) delete env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (account.configDir) env["CLAUDE_CONFIG_DIR"] = account.configDir;
  const command = account.tokenCommand;
  if (command) {
    let token = tokens.get(command);
    if (!token) {
      token = runTokenCommand(command);
      tokens.set(command, token);
      token.catch(() => tokens.delete(command));
    }
    env["CLAUDE_CODE_OAUTH_TOKEN"] = await token;
  }
  return env;
}

export interface AuthStatus {
  loggedIn: boolean;
  email?: string;
  detail?: string;
}

/** "logged in as <email>" for a signed-in account, "" otherwise. */
export function describeLogin(status: AuthStatus): string {
  return status.loggedIn ? `logged in${status.email ? ` as ${status.email}` : ""}` : "";
}

/** Each account with its {@link authStatus}, checked in parallel. */
export async function withAuthStatus(
  accounts: Account[],
): Promise<Array<{ account: Account; status: AuthStatus }>> {
  const statuses = await Promise.all(accounts.map((account) => authStatus(account)));
  return accounts.map((account, index) => ({ account, status: statuses[index]! }));
}

/** `claude auth status` (JSON, exit 1 when logged out) under this account. */
export async function authStatus(account: Account): Promise<AuthStatus> {
  try {
    const { stdout } = await promisify(execFile)(
      claudeExecutable() ?? "claude",
      ["auth", "status"],
      { env: await accountEnv(account), timeout: 15_000 },
    );
    const status = JSON.parse(stdout) as { loggedIn?: boolean; email?: string };
    return { loggedIn: status.loggedIn === true, ...(status.email ? { email: status.email } : {}) };
  } catch (error) {
    const stdout = String((error as { stdout?: unknown }).stdout ?? "");
    try {
      if ((JSON.parse(stdout) as { loggedIn?: boolean }).loggedIn === false)
        return { loggedIn: false };
    } catch {}
    return {
      loggedIn: false,
      detail: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
    };
  }
}

export interface LoginPrompts {
  /** Called once with the sign-in URL; resolves to the code the user pasted, or undefined. */
  askCode(url: string, signal: AbortSignal): Promise<string | undefined>;
}

/**
 * Run `claude auth login` in the account's config dir. Claude Code prints a
 * sign-in URL and either finishes on its own (browser callback) or reads the
 * code the user pastes.
 */
export async function loginAccount(account: Account, prompts: LoginPrompts): Promise<void> {
  if (!account.configDir && account.tokenCommand) {
    throw new Error(`"${account.name}" signs in with its tokenCommand, not a Claude login`);
  }
  if (account.configDir) mkdirSync(account.configDir, { recursive: true });
  const child = spawnProcess(claudeExecutable() ?? "claude", ["auth", "login"], {
    env: await accountEnv(account),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new AbortController();
  let output = "";
  let asked = false;
  let cancelled = false;
  const onOutput = (chunk: Buffer) => {
    output = (output + String(chunk)).slice(-4_000);
    const url = /https:\/\/\S+/.exec(output)?.[0];
    if (asked || !url || !/\r?\n/.test(output.slice(output.indexOf(url)))) return;
    asked = true;
    void prompts.askCode(url, exited.signal).then((code) => {
      if (exited.signal.aborted) return;
      if (code?.trim()) child.stdin.write(`${code.trim()}\n`);
      else {
        cancelled = true;
        child.kill();
      }
    });
  };
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);
  const code = await waitForChildProcess(child);
  exited.abort();
  if (cancelled) throw new Error(`Login for "${account.name}" cancelled`);
  if (code !== 0) {
    const lines = output
      .trim()
      .split("\n")
      .filter((line) => !line.includes("https://"));
    throw new Error(`claude auth login failed: ${lines.at(-1) || `exit ${code}`}`);
  }
  const blocks = loadBlocks();
  delete blocks[account.name];
  saveBlocks(blocks);
}

export async function logoutAccount(account: Account): Promise<void> {
  await promisify(execFile)(claudeExecutable() ?? "claude", ["auth", "logout"], {
    env: await accountEnv(account),
    timeout: 15_000,
  });
}

function loadBlocks(): Record<string, Block> {
  try {
    return JSON.parse(readFileSync(blocksFile(), "utf8")) as Record<string, Block>;
  } catch {
    return {};
  }
}

function saveBlocks(blocks: Record<string, Block>): void {
  const file = blocksFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(blocks, null, 2));
}

export function blockOf(account: Account, now = Date.now()): Block | undefined {
  const block = loadBlocks()[account.name];
  return block && block.until > now ? block : undefined;
}

export function clearBlocks(): void {
  saveBlocks({});
}

export interface RunFailure {
  error: string;
  /** Claude Code's classification: a used-up plan limit, or the API error of its error notice. */
  cause?: "usage_limit" | SDKAssistantMessageError;
  /** When the rejected plan limit resets, in ms. */
  resetsAt?: number;
}

const DISABLED_CAUSES = new Set<RunFailure["cause"]>([
  "oauth_org_not_allowed",
  "account_on_hold",
  "billing_error",
]);

/** If a failed run means the account cannot serve requests for a while, record it and return true. */
export function blockIfUnusable(account: Account, failure: RunFailure): boolean {
  const { error, cause } = failure;
  let until: number | undefined;
  if (cause === "usage_limit") until = failure.resetsAt ?? Date.now() + FALLBACK_BLOCK_MS;
  // Failures before any API call (no login, a failed tokenCommand) come without a classification.
  else if (
    cause === "authentication_failed" ||
    /^tokenCommand /.test(error) ||
    /not logged in|please run \/login/i.test(error)
  ) {
    until = Date.now() + LOGGED_OUT_BLOCK_MS;
  } else if (DISABLED_CAUSES.has(cause)) {
    until = Date.now() + DISABLED_BLOCK_MS;
  }
  if (until === undefined) return false;
  const blocks = loadBlocks();
  blocks[account.name] = { until, reason: error.split("\n")[0]!.slice(0, 200) };
  saveBlocks(blocks);
  return true;
}
