import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Clock, Data, Effect, Stream } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import claudeAccounts from "../src/core/cli-agents/claude-accounts.ts";
import claudeCode from "../src/core/cli-agents/claude-code.ts";
import cliAgentsSupport from "./cli-agents-support.ts";

const { blockIfUnusable, loadAccounts } = claudeAccounts;
const { claudeCodeProviders } = claudeCode;
const { providerUnusableReason } = compat;
const { runTest } = testing;
const { cleanAgentDir, prepareAgentDir, writeAccounts } = cliAgentsSupport;

const HOUR = 3_600_000;

class StreamFailed extends Data.TaggedError("StreamFailed")<{ readonly cause: unknown }> {}

beforeEach(() => runTest(prepareAgentDir));

afterEach(() => runTest(cleanAgentDir));

const lastEvent = Effect.gen(function* () {
  const provider = claudeCodeProviders()[0]!;
  const model = provider.getModels()[0]!;
  const context = {
    messages: [{ content: "hello", role: "user", timestamp: 0 }],
  } as unknown as compatTypes.TranscriptContext;
  const events: compatTypes.AssistantMessageEvent[] = [];
  yield* Stream.runForEach(
    Stream.fromAsyncIterable(
      provider.streamSimple(model, context),
      (cause) => new StreamFailed({ cause }),
    ),
    (event) => Effect.sync(() => events.push(event)),
  ).pipe(Effect.orDie);
  return events.at(-1);
});

const carriesTheFirstResetWhenEveryAccountIsBlocked = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("CLAUDE_BIN", "/bin/false");
      yield* writeAccounts([{ name: "main" }, { name: "sub" }]);
      const [main, sub] = yield* Effect.promise(() => loadAccounts());
      const now = yield* Clock.currentTimeMillis;
      for (const [account, resetsAt] of [
        [main!, now + 2 * HOUR],
        [sub!, now + HOUR],
      ] as const) {
        yield* Effect.promise(() =>
          blockIfUnusable(account, {
            cause: "usage_limit",
            error: "You've hit your session limit",
            resetsAt,
          }),
        );
      }

      const last = yield* lastEvent;

      expect(last?.type).toBe("error");
      if (last?.type !== "error") return;
      expect(last.error.errorMessage).toMatch(/^No Claude account available\./u);
      expect(last.error.errorResetsAt).toBe(now + HOUR);
      expect(providerUnusableReason(last.error)).toBe("quota");
    }),
  );

it(
  "carries the earliest reset time when every Claude account is blocked by its limit",
  carriesTheFirstResetWhenEveryAccountIsBlocked,
);
