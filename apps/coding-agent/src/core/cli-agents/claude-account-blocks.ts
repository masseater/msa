import config from "../../config.ts";
import platform from "../platform/index.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";

const { getAgentDir } = config;
const { nowMs } = platform;
const { makeDirectory, readText, writeFile } = platform.files;
const { dirname, join } = platform;

const blocksFile = () => join(getAgentDir(), "state", "claude-code-blocks.json");
const FALLBACK_BLOCK_MS = 60 * 60_000;
const LOGGED_OUT_BLOCK_MS = 10 * 60_000;
const DISABLED_BLOCK_MS = 24 * 60 * 60_000;

const DISABLED_CAUSES = new Set<claudeAccountsTypes.RunFailure["cause"]>([
  "oauth_org_not_allowed",
  "account_on_hold",
  "billing_error",
]);

type Blocks = Record<string, claudeAccountsTypes.AccountBlock>;

function loadBlocks(): Promise<Blocks> {
  return readText(blocksFile()).then(
    (raw) => JSON.parse(raw) as Blocks,
    () => ({}),
  );
}

function saveBlocks(blocks: Blocks): Promise<void> {
  const file = blocksFile();
  return makeDirectory({ path: dirname(file) }).then(() =>
    writeFile({ data: JSON.stringify(blocks, null, 2), path: file }),
  );
}

function blockOf(
  account: claudeAccountsTypes.Account,
  now = nowMs(),
): Promise<claudeAccountsTypes.AccountBlock | undefined> {
  return loadBlocks().then((blocks) => {
    const block = blocks[account.name];
    return block !== undefined && block.until > now ? block : undefined;
  });
}

function clearBlocks(): Promise<void> {
  return saveBlocks({});
}

function clearBlock(name: string): Promise<void> {
  return loadBlocks().then((blocks) => {
    delete blocks[name];
    return saveBlocks(blocks);
  });
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
): Promise<boolean> {
  const until = blockedUntil(failure);
  if (until === undefined) return Promise.resolve(false);
  return loadBlocks()
    .then((blocks) => {
      blocks[account.name] = { reason: failure.error.split("\n")[0]!.slice(0, 200), until };
      return saveBlocks(blocks);
    })
    .then(() => true);
}

const claudeAccountBlocks = { blockIfUnusable, blockOf, clearBlock, clearBlocks };

export default claudeAccountBlocks;
