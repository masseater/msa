import testing from "@msa/testing";
import { Clock, Duration, Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";

import type ghTypes from "../src/core/pr-watch/gh.types.ts";
import PrWatchGhError from "../src/core/pr-watch/pr-watch-gh-error.ts";
import type snapshotTypes from "../src/core/pr-watch/snapshot.types.ts";
import watch from "../src/core/pr-watch/watch.ts";
import type watchTypes from "../src/core/pr-watch/watch.types.ts";
import type prWatchLoopSupportTypes from "./pr-watch-loop-support.types.ts";
const { createPrWatchEntry, prWatchLoop } = watch;

const { runTest } = testing;

const INTERVAL_MS = 45_000;

const STATUS_INTERVAL_MS = 300_000;

const snapshotOf = (
  overrides: Partial<snapshotTypes.PrSnapshot> = {},
): snapshotTypes.PrSnapshot => ({
  baseRefName: "main",
  behindBy: undefined,
  checks: {
    cancelled: 0,
    failed: 0,
    passed: 0,
    pending: 2,
    pendingNames: ["verify"],
    pendingWorkflows: ["verify"],
    total: 2,
  },
  comments: 0,
  headRefOid: "head-oid",
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  reviewDecision: "REVIEW_REQUIRED",
  state: "OPEN",
  updatedAt: "2024-05-01T00:00:00Z",
  ...overrides,
});

const pendingChecks = snapshotOf();

const scriptedGh = (
  steps: ReadonlyArray<snapshotTypes.PrSnapshot | ghTypes.PrWatchGhError>,
  behindBy?: number,
  history: prWatchLoopSupportTypes.ScriptedHistory = {},
): prWatchLoopSupportTypes.ScriptedGh => {
  const calls = { count: 0 };
  const behindCalls = { count: 0 };
  const runsCalls = { count: 0 };
  const runSteps = history.runs ?? [undefined];
  return {
    behindCalls,
    calls,
    gh: {
      behind: () => {
        behindCalls.count += 1;
        return behindBy === undefined
          ? Effect.fail(PrWatchGhError.make({ kind: "other", message: "no compare" }))
          : Effect.succeed(behindBy);
      },
      runs: () => {
        const runs = runSteps[Math.min(runsCalls.count, runSteps.length - 1)];
        runsCalls.count += 1;
        return runs === undefined
          ? Effect.fail(PrWatchGhError.make({ kind: "other", message: "no runs" }))
          : Effect.succeed(runs);
      },
      timeouts: () => Effect.succeed(history.timeouts ?? []),
      view: () => {
        const step = steps[Math.min(calls.count, steps.length - 1)]!;
        calls.count += 1;
        return Schema.is(PrWatchGhError)(step) ? Effect.fail(step) : Effect.succeed(step);
      },
    },
    runsCalls,
  };
};

const runPolls = (
  script: prWatchLoopSupportTypes.ScriptedGh,
  advances: readonly number[],
): Promise<prWatchLoopSupportTypes.RunResult> =>
  runTest(
    Effect.gen(function* () {
      const notifications: watchTypes.PrNotification[] = [];
      const changes = { count: 0 };
      const entry = createPrWatchEntry({ number: 12 }, INTERVAL_MS, STATUS_INTERVAL_MS);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* TestClock.make();
          const fiber = yield* prWatchLoop({
            entry,
            gh: script.gh,
            host: {
              changed: () => {
                changes.count += 1;
              },
              notify: (notification) => {
                notifications.push(notification);
              },
            },
          }).pipe(Effect.provideService(Clock.Clock, clock), Effect.forkChild);
          yield* Effect.yieldNow;
          for (const advance of advances) {
            yield* clock.adjust(Duration.millis(advance));
            yield* Effect.yieldNow;
          }
          yield* Fiber.interrupt(fiber);
        }),
      );
      return {
        behindCalls: script.behindCalls.count,
        calls: script.calls.count,
        changes: changes.count,
        entry,
        notifications,
        runsCalls: script.runsCalls.count,
      };
    }),
  );

const seen = (result: prWatchLoopSupportTypes.RunResult) =>
  result.notifications.map(({ label, text }) => ({ label, text }));

const prWatchLoopSupport = {
  INTERVAL_MS,
  STATUS_INTERVAL_MS,
  pendingChecks,
  runPolls,
  scriptedGh,
  seen,
  snapshotOf,
};

export default prWatchLoopSupport;
