import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Clock, Effect } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import claudeSubsFailureSupport from "./claude-subs-failure-support.ts";
import cliAgentsSupport from "./cli-agents-support.ts";

const { providerUnusableReason } = compat;
const { runTest } = testing;
const { cleanAgentDir, prepareAgentDir, writeAccounts } = cliAgentsSupport;
const { blockAccounts, claudeSubsFailure } = claudeSubsFailureSupport;

const HOUR = 3_600_000;
const SESSION_LIMIT = "You've hit your session limit";

beforeEach(() => runTest(prepareAgentDir));

afterEach(() => runTest(cleanAgentDir));

const marksTheLimitAsQuotaWhenEveryAccountIsLimited = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("CLAUDE_BIN", "/bin/false");
      yield* writeAccounts([{ name: "main" }, { name: "sub" }]);
      const now = yield* Clock.currentTimeMillis;
      yield* blockAccounts([
        { cause: "usage_limit", error: SESSION_LIMIT, resetsAt: now + 2 * HOUR },
        { cause: "usage_limit", error: SESSION_LIMIT, resetsAt: now + HOUR },
      ]);

      const error = yield* claudeSubsFailure;

      expect(error.errorMessage).toMatch(/^No Claude account available\./u);
      expect(error.errorResetsAt).toBe(now + HOUR);
      expect(providerUnusableReason(error)).toBe("quota");
    }),
  );

it(
  "marks the failure with the quota kind and the earliest reset when every account hit its limit",
  marksTheLimitAsQuotaWhenEveryAccountIsLimited,
);

const leavesOtherBlocksUnjudged = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("CLAUDE_BIN", "/bin/false");
      yield* writeAccounts([{ name: "main" }, { name: "sub" }]);
      const now = yield* Clock.currentTimeMillis;
      yield* blockAccounts([
        { cause: "usage_limit", error: SESSION_LIMIT, resetsAt: now + HOUR },
        { cause: "authentication_failed", error: "Not logged in · Please run /login" },
      ]);

      const error = yield* claudeSubsFailure;

      expect(error.errorMessage).toMatch(/^No Claude account available\./u);
      expect(error.errorResetsAt).toBeUndefined();
      expect(providerUnusableReason(error)).toBeUndefined();
    }),
  );

it(
  "carries no error kind when an account is blocked for something other than its limit",
  leavesOtherBlocksUnjudged,
);
