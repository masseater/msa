import { homedir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import claudeAccounts from "../src/core/cli-agents/claude-accounts.ts";
import modelPolicy from "../src/core/model-policy.ts";
import modelUpgrade from "../src/core/model-upgrade.ts";
import cliAgentsSupport from "./cli-agents-support.ts";

const { accountEnv, blockIfUnusable, blockOf, clearBlocks, loadAccounts } = claudeAccounts;
const { evaluateModelPolicy, hiddenModelsByPolicy } = modelPolicy;
const { findModelUpgrades } = modelUpgrade;

const { awaited, currentTimeMillis, failure, joinPath, runTest } = testing;
const { cleanAgentDir, createModelRuntime, currentAgentDir, prepareAgentDir, writeAccounts } =
  cliAgentsSupport;

beforeEach(() => runTest(prepareAgentDir));

afterEach(() => runTest(cleanAgentDir));

const usesMsaSEnvironmentWhenNoAccounts = () => {
  expect(loadAccounts()).toEqual([{ name: "default" }]);
};

const expandsInConfigdir = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeAccounts([{ configDir: "~/claude-main", name: "main" }]);
      expect(loadAccounts()).toEqual([
        { configDir: joinPath(homedir(), "claude-main"), name: "main" },
      ]);
    }),
  );

const blocksAnAccountThatHitItsUsage = () => {
  const account = { name: "main" };
  const resetsAt = currentTimeMillis() + 3_600_000;
  expect(
    blockIfUnusable(account, {
      cause: "usage_limit",
      error: "You've hit your weekly limit",
      resetsAt,
    }),
  ).toBe(true);
  expect(blockOf(account, resetsAt - 60_000)?.reason).toContain("weekly limit");
  expect(blockOf(account, resetsAt + 60_000)).toBeUndefined();
  clearBlocks();
  expect(blockOf(account, resetsAt - 60_000)).toBeUndefined();
};

const blocksAnAccountByTheErrorClaude = () => {
  const now = currentTimeMillis();
  const account = { name: "main" };
  expect(blockIfUnusable(account, { cause: "authentication_failed", error: "401" })).toBe(true);
  expect(blockOf(account, now + 60_000)).toBeDefined();
  expect(blockOf(account, now + 11 * 60_000)).toBeUndefined();
  expect(blockIfUnusable(account, { cause: "account_on_hold", error: "on hold" })).toBe(true);
  expect(blockOf(account, now + 23 * 60 * 60_000)).toBeDefined();
};

const doesNotBlockAnAccountForAn = () => {
  const account = { name: "main" };
  expect(blockIfUnusable(account, { cause: "overloaded", error: "overloaded" })).toBe(false);
  expect(blockIfUnusable(account, { cause: "rate_limit", error: "429" })).toBe(false);
  expect(blockOf(account)).toBeUndefined();
};

const givesTheTokenPrintedByTokencommandOnly = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "inherited");
      vi.stubEnv("SHELL", "/bin/sh");
      const env = yield* awaited(
        accountEnv({ name: "token", tokenCommand: "printf 'tok-123\\n'" }),
      );
      expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("tok-123");
      const configured = yield* awaited(accountEnv({ configDir: "/tmp/claude-dir", name: "dir" }));
      expect(configured["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
      expect(configured["CLAUDE_CONFIG_DIR"]).toBe("/tmp/claude-dir");
    }),
  );

const blocksAnAccountWhoseTokencommandFails = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("SHELL", "/bin/sh");
      const account = { name: "broken", tokenCommand: "echo nope >&2; exit 1" };
      const error = yield* failure(awaited(accountEnv(account)));
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/^tokenCommand .*: nope$/u);
      expect(blockIfUnusable(account, { error: message })).toBe(true);
    }),
  );

describe("Claude Code accounts", () => {
  it("uses msa's environment when no accounts are configured", usesMsaSEnvironmentWhenNoAccounts);

  it("expands ~ in configDir", expandsInConfigdir);

  it("blocks an account that hit its usage limit until the reset", blocksAnAccountThatHitItsUsage);

  it("blocks an account by the error Claude Code classified", blocksAnAccountByTheErrorClaude);

  it("does not block an account for an ordinary failure", doesNotBlockAnAccountForAn);

  it(
    "gives the token printed by tokenCommand only to that account",
    givesTheTokenPrintedByTokencommandOnly,
  );

  it("blocks an account whose tokenCommand fails", blocksAnAccountWhoseTokencommandFails);
});

const areAvailableWithoutExtensionsAndFollowThe = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("CLAUDE_BIN", process.execPath);
      const runtime = yield* createModelRuntime();
      const providers = () =>
        [...new Set(runtime.getAvailableSnapshot().map((model) => model.provider))]
          .filter((id) => id.startsWith("claude-subs"))
          .sort();
      expect(providers()).toEqual(["claude-subs"]);
      expect(runtime.getModel("claude-subs", "claude-opus-5-5")?.api).toBe("claude-subs");

      yield* writeAccounts([{ name: "main" }, { name: "sub" }]);
      yield* awaited(runtime.refresh({ allowNetwork: false }));
      expect(providers()).toEqual(["claude-subs", "claude-subs-main", "claude-subs-sub"]);

      vi.stubEnv("CLAUDE_BIN", joinPath(currentAgentDir(), "missing-claude"));
      yield* awaited(runtime.refresh({ allowNetwork: false }));
      expect(providers()).toEqual([]);
    }),
  );

describe("Claude subscription providers", () => {
  it(
    "are available without extensions and follow the account list on refresh",
    areAvailableWithoutExtensionsAndFollowThe,
  );
});

const claudeModels = Effect.gen(function* () {
  vi.stubEnv("CLAUDE_BIN", process.execPath);
  const runtime = yield* createModelRuntime();
  return runtime.getAvailableSnapshot().filter((model) => model.provider === "claude-subs");
});

const listsTheVersionedIdsAndNoAlias = () =>
  runTest(
    Effect.gen(function* () {
      const models = yield* claudeModels;
      expect(models.map((model) => model.id).sort()).toEqual([
        "claude-fable-5-1",
        "claude-haiku-5-5",
        "claude-opus-5-5",
        "claude-sonnet-5-5",
      ]);
    }),
  );

const appliesAModelPolicyToAVersioned = () =>
  runTest(
    Effect.gen(function* () {
      const models = yield* claudeModels;
      const deny = { allow: [], deny: ["claude-subs/claude-opus-5-5"] };
      const hidden = hiddenModelsByPolicy(deny, models).map((entry) => entry.model.id);
      expect(hidden).toEqual(["claude-opus-5-5"]);
      const sonnet = models.find((model) => model.id === "claude-sonnet-5-5")!;
      expect(evaluateModelPolicy(deny, sonnet).allowed).toBe(true);
      expect(
        evaluateModelPolicy({ allow: ["claude-subs/claude-sonnet-5-5"], deny: [] }, sonnet).allowed,
      ).toBe(true);
    }),
  );

const letsModelUpgradesReadAVersionFrom = () =>
  runTest(
    Effect.gen(function* () {
      const models = yield* claudeModels;
      const older = {
        ...models.find((model) => model.id === "claude-sonnet-5-5")!,
        id: "claude-sonnet-5",
      };
      const upgrades = findModelUpgrades([older, ...models]).filter(
        (candidate) => candidate.confident,
      );
      expect(upgrades.map((candidate) => [candidate.from.id, candidate.to.id])).toEqual([
        ["claude-sonnet-5", "claude-sonnet-5-5"],
      ]);
    }),
  );

describe("Claude subscription model ids", () => {
  it("lists the versioned ids and no alias", listsTheVersionedIdsAndNoAlias);

  it("applies a model policy to a versioned id", appliesAModelPolicyToAVersioned);

  it("lets model upgrades read a version from the full ids", letsModelUpgradesReadAVersionFrom);
});
