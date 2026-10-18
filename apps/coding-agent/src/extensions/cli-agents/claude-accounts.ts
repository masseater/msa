import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { SDKAssistantMessageError } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";

import { expandTildePath, getAgentDir } from "../../config.ts";
import { awaited, awaiting } from "../../core/awaiting.ts";
import { nowMs, readEnv } from "../../core/platform.ts";
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
    account.configDir !== undefined && account.configDir !== ""
      ? { ...account, configDir: expandTildePath(account.configDir) }
      : account,
  );
}

function editAccounts(change: (accounts: Account[]) => Account[]): void {
  const accounts = change(readAccounts());
  if (accounts.length === 0) throw new Error("At least one Claude account must remain");
  const file = configFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ accounts }, null, 2)}\n`);
}

function findAccount(accounts: Account[], name: string): Account {
  const account = accounts.find((candidate) => candidate.name === name);
  if (account === undefined) throw new Error(`No Claude account named "${name}"`);
  return account;
}

export function addAccount(name: string, tokenCommand?: string): Account {
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(name)) {
    throw new Error(`Account name "${name}" must be lowercase letters, digits, "-" or "_"`);
  }
  const account: Account =
    tokenCommand !== undefined && tokenCommand !== ""
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

export function removeAccount(name: string): void {
  let removed: Account | undefined;
  editAccounts((accounts) => {
    removed = findAccount(accounts, name);
    return accounts.filter((candidate) => candidate !== removed);
  });
  if (
    removed?.configDir !== undefined &&
    removed?.configDir !== "" &&
    expandTildePath(removed.configDir) === managedDir(name)
  ) {
    rmSync(managedDir(name), { recursive: true, force: true });
  }
  const blocks = loadBlocks();
  delete blocks[name];
  saveBlocks(blocks);
}

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

export function claudeExecutable(): string | undefined {
  return readEnv("CLAUDE_BIN")?.trim() || findExecutableOnPath("claude") || undefined;
}

const tokens = new Map<string, Promise<string>>();

function runTokenCommand(command: string): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      let stdout: string;
      try {
        ({ stdout } = yield* awaited(
          promisify(execFile)(readEnv("SHELL") || "/bin/sh", ["-c", command]),
        ));
      } catch (error) {
        const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
        throw new Error(`tokenCommand ${command}: ${stderr.split("\n").at(-1) || "failed"}`, {
          cause: error,
        });
      }
      const token = stdout.trim();
      if (token === "") throw new Error(`tokenCommand ${command}: printed nothing`);
      return token;
    }),
  );
}

export function accountEnv(account: Account): Promise<Record<string, string>> {
  return Effect.runPromise(
    awaiting(function* () {
      const env = { ...process.env } as Record<string, string>;
      delete env["CLAUDECODE"];
      if (
        (account.configDir !== undefined && account.configDir !== "") ||
        (account.tokenCommand !== undefined && account.tokenCommand !== "")
      )
        delete env["CLAUDE_CODE_OAUTH_TOKEN"];
      if (account.configDir !== undefined && account.configDir !== "")
        env["CLAUDE_CONFIG_DIR"] = account.configDir;
      const command = account.tokenCommand;
      if (command !== undefined && command !== "") {
        let token = tokens.get(command);
        if (token === undefined) {
          token = runTokenCommand(command);
          tokens.set(command, token);
          token.catch(() => tokens.delete(command));
        }
        env["CLAUDE_CODE_OAUTH_TOKEN"] = yield* awaited(token);
      }
      return env;
    }),
  );
}

export interface AuthStatus {
  loggedIn: boolean;
  email?: string;
  detail?: string;
}

export function describeLogin(status: AuthStatus): string {
  return status.loggedIn
    ? `logged in${status.email !== undefined && status.email !== "" ? ` as ${status.email}` : ""}`
    : "";
}

export function withAuthStatus(
  accounts: Account[],
): Promise<Array<{ account: Account; status: AuthStatus }>> {
  return Effect.runPromise(
    awaiting(function* () {
      const statuses = yield* awaited(Promise.all(accounts.map((account) => authStatus(account))));
      return accounts.map((account, index) => ({ account, status: statuses[index]! }));
    }),
  );
}

export function authStatus(account: Account): Promise<AuthStatus> {
  return Effect.runPromise(
    awaiting(function* () {
      try {
        const { stdout } = yield* awaited(
          promisify(execFile)(claudeExecutable() ?? "claude", ["auth", "status"], {
            env: yield* awaited(accountEnv(account)),
            timeout: 15_000,
          }),
        );
        const status = JSON.parse(stdout) as { loggedIn?: boolean; email?: string };
        return {
          loggedIn: status.loggedIn === true,
          ...(status.email !== undefined && status.email !== "" ? { email: status.email } : {}),
        };
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
    }),
  );
}

export interface LoginPrompts {
  askCode(url: string, signal: AbortSignal): Promise<string | undefined>;
}

export function loginAccount(account: Account, prompts: LoginPrompts): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      if (
        (account.configDir === undefined || account.configDir === "") &&
        account.tokenCommand !== undefined &&
        account.tokenCommand !== ""
      ) {
        throw new Error(`"${account.name}" signs in with its tokenCommand, not a Claude login`);
      }
      if (account.configDir !== undefined && account.configDir !== "")
        mkdirSync(account.configDir, { recursive: true });
      const child = spawnProcess(claudeExecutable() ?? "claude", ["auth", "login"], {
        env: yield* awaited(accountEnv(account)),
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exited = new AbortController();
      let output = "";
      let asked = false;
      let cancelled = false;
      const onOutput = (chunk: Buffer) => {
        output = (output + String(chunk)).slice(-4_000);
        const url = /https:\/\/\S+/u.exec(output)?.[0];
        if (
          asked ||
          url === undefined ||
          url === "" ||
          !/\r?\n/u.test(output.slice(output.indexOf(url)))
        )
          return;
        asked = true;
        void prompts.askCode(url, exited.signal).then((code) => {
          if (exited.signal.aborted) return;
          if (code !== undefined && code.trim() !== "") child.stdin.write(`${code.trim()}\n`);
          else {
            cancelled = true;
            child.kill();
          }
        });
      };
      child.stdout.on("data", onOutput);
      child.stderr.on("data", onOutput);
      const code = yield* awaited(waitForChildProcess(child));
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
    }),
  );
}

export function logoutAccount(account: Account): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(
        promisify(execFile)(claudeExecutable() ?? "claude", ["auth", "logout"], {
          env: yield* awaited(accountEnv(account)),
          timeout: 15_000,
        }),
      );
    }),
  );
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

export function blockOf(account: Account, now = nowMs()): Block | undefined {
  const block = loadBlocks()[account.name];
  return block !== undefined && block.until > now ? block : undefined;
}

export function clearBlocks(): void {
  saveBlocks({});
}

export interface RunFailure {
  error: string;

  cause?: "usage_limit" | SDKAssistantMessageError;

  resetsAt?: number;
}

const DISABLED_CAUSES = new Set<RunFailure["cause"]>([
  "oauth_org_not_allowed",
  "account_on_hold",
  "billing_error",
]);

export function blockIfUnusable(account: Account, failure: RunFailure): boolean {
  const { error, cause } = failure;
  let until: number | undefined;
  if (cause === "usage_limit") until = failure.resetsAt ?? nowMs() + FALLBACK_BLOCK_MS;
  else if (
    cause === "authentication_failed" ||
    /^tokenCommand /u.test(error) ||
    /not logged in|please run \/login/iu.test(error)
  ) {
    until = nowMs() + LOGGED_OUT_BLOCK_MS;
  } else if (DISABLED_CAUSES.has(cause)) {
    until = nowMs() + DISABLED_BLOCK_MS;
  }
  if (until === undefined) return false;
  const blocks = loadBlocks();
  blocks[account.name] = { until, reason: error.split("\n")[0]!.slice(0, 200) };
  saveBlocks(blocks);
  return true;
}
