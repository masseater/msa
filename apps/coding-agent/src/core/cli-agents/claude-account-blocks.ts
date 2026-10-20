import config from "../../config.ts";
import platform from "../platform.ts";
import nodeFs from "../platform/node/fs.ts";
import nodePath from "../platform/node/path.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";

const { getAgentDir } = config;
const { nowMs } = platform;
const { mkdirSync, readFileSync, writeFileSync } = nodeFs;
const { dirname, join } = nodePath;

const blocksFile = () => join(getAgentDir(), "state", "claude-code-blocks.json");
const FALLBACK_BLOCK_MS = 60 * 60_000;
const LOGGED_OUT_BLOCK_MS = 10 * 60_000;
const DISABLED_BLOCK_MS = 24 * 60 * 60_000;

const DISABLED_CAUSES = new Set<claudeAccountsTypes.RunFailure["cause"]>([
  "oauth_org_not_allowed",
  "account_on_hold",
  "billing_error",
]);

function loadBlocks(): Record<string, claudeAccountsTypes.AccountBlock> {
  try {
    return JSON.parse(readFileSync(blocksFile(), "utf8")) as Record<
      string,
      claudeAccountsTypes.AccountBlock
    >;
  } catch {
    return {};
  }
}

function saveBlocks(blocks: Record<string, claudeAccountsTypes.AccountBlock>): void {
  const file = blocksFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(blocks, null, 2));
}

function blockOf(
  account: claudeAccountsTypes.Account,
  now = nowMs(),
): claudeAccountsTypes.AccountBlock | undefined {
  const block = loadBlocks()[account.name];
  return block !== undefined && block.until > now ? block : undefined;
}

function clearBlocks(): void {
  saveBlocks({});
}

function clearBlock(name: string): void {
  const blocks = loadBlocks();
  delete blocks[name];
  saveBlocks(blocks);
}

function blockedUntil(failure: claudeAccountsTypes.RunFailure): number | undefined {
  const { error, cause } = failure;
  if (cause === "usage_limit") return failure.resetsAt ?? nowMs() + FALLBACK_BLOCK_MS;
  if (
    cause === "authentication_failed" ||
    /^tokenCommand /u.test(error) ||
    /not logged in|please run \/login/iu.test(error)
  )
    return nowMs() + LOGGED_OUT_BLOCK_MS;
  if (DISABLED_CAUSES.has(cause)) return nowMs() + DISABLED_BLOCK_MS;
  return undefined;
}

function blockIfUnusable(
  account: claudeAccountsTypes.Account,
  failure: claudeAccountsTypes.RunFailure,
): boolean {
  const until = blockedUntil(failure);
  if (until === undefined) return false;
  const blocks = loadBlocks();
  blocks[account.name] = { reason: failure.error.split("\n")[0]!.slice(0, 200), until };
  saveBlocks(blocks);
  return true;
}

const claudeAccountBlocks = { blockIfUnusable, blockOf, clearBlock, clearBlocks };

export default claudeAccountBlocks;
