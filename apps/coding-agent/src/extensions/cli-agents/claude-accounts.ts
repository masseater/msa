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
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { expandTildePath, getAgentDir } from "../../config.ts";

const configFile = () => join(getAgentDir(), "claude-code-accounts.json");
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

export function loadAccounts(): Account[] {
  let raw: string;
  try {
    raw = readFileSync(configFile(), "utf8");
  } catch {
    return [{ name: "default" }];
  }
  const parsed = JSON.parse(raw) as { accounts?: Account[] };
  const accounts = (parsed.accounts ?? []).map((account) =>
    account.configDir ? { ...account, configDir: expandTildePath(account.configDir) } : account,
  );
  if (accounts.length === 0) throw new Error(`${configFile()} lists no accounts`);
  return accounts;
}

const tokens = new Map<string, Promise<string>>();

async function runTokenCommand(command: string): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(process.env["SHELL"] || "/bin/sh", ["-c", command]));
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    throw new Error(`tokenCommand ${command}: ${stderr.split("\n").at(-1) || "failed"}`);
  }
  const token = stdout.trim();
  if (!token) throw new Error(`tokenCommand ${command}: printed nothing`);
  return token;
}

/** Environment for this account's Claude Code process. */
export async function accountEnv(account: Account): Promise<Record<string, string>> {
  const env = { ...process.env } as Record<string, string>;
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

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parse "resets Oct 19 at 3pm" / "resets 3:30pm" (local time) from a usage-limit message. */
export function parseReset(message: string, now = new Date()): number | undefined {
  const match =
    /resets\s+(?:([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:\s+at)?\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i.exec(
      message,
    );
  if (!match) return undefined;
  const [, month, day, hour, minute, meridiem] = match;
  const at = new Date(now);
  at.setSeconds(0, 0);
  at.setHours(
    (Number(hour) % 12) + (meridiem!.toLowerCase() === "pm" ? 12 : 0),
    Number(minute ?? 0),
  );
  if (month && day) {
    const monthIndex = MONTHS.indexOf(month.toLowerCase());
    if (monthIndex < 0) return undefined;
    at.setMonth(monthIndex, Number(day));
    if (at.getTime() < now.getTime() - 24 * 60 * 60_000) at.setFullYear(at.getFullYear() + 1);
  } else if (at.getTime() <= now.getTime()) {
    at.setDate(at.getDate() + 1);
  }
  return at.getTime();
}

/** If a failed run means the account cannot serve requests for a while, record it and return true. */
export function blockIfUnusable(account: Account, message: string, limited: boolean): boolean {
  let until: number | undefined;
  if (limited || /hit your .*limit/i.test(message))
    until = parseReset(message) ?? Date.now() + FALLBACK_BLOCK_MS;
  else if (
    /not logged in|please run \/login|invalid api key|oauth token has expired/i.test(message)
  ) {
    until = Date.now() + LOGGED_OUT_BLOCK_MS;
  } else if (/^tokenCommand /.test(message)) {
    until = Date.now() + LOGGED_OUT_BLOCK_MS;
  } else if (/disabled claude subscription access|organization has been disabled/i.test(message)) {
    until = Date.now() + DISABLED_BLOCK_MS;
  }
  if (until === undefined) return false;
  const blocks = loadBlocks();
  blocks[account.name] = { until, reason: message.split("\n")[0]!.slice(0, 200) };
  saveBlocks(blocks);
  return true;
}
