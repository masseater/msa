import { Clock, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vite-plus/test";

import { PrWatchGhError } from "../src/core/pr-watch/gh.ts";
import {
  createPrWatchEntry,
  type PrNotification,
  type PrWatchEntry,
  prWatchLoop,
} from "../src/core/pr-watch/watch.ts";
import {
  createHost,
  INTERVAL_MS,
  pendingChecks,
  scriptedGh,
  type ScriptedGh,
  snapshotOf,
} from "./pr-watch-support.ts";

interface RunResult {
  readonly entry: PrWatchEntry;
  readonly notifications: PrNotification[];
  readonly changes: number;
  readonly calls: number;
}

const runPolls = async (script: ScriptedGh, advances: readonly number[]): Promise<RunResult> => {
  const host = createHost();
  const entry = createPrWatchEntry({ number: 12 }, INTERVAL_MS);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* TestClock.make();
        const fiber = yield* prWatchLoop({ gh: script.gh, entry, host: host.host }).pipe(
          Effect.provideService(Clock.Clock, clock),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        for (const advance of advances) {
          yield* clock.adjust(Duration.millis(advance));
          yield* Effect.yieldNow;
        }
        yield* Fiber.interrupt(fiber);
      }),
    ),
  );
  return {
    entry,
    notifications: host.notifications,
    changes: host.changes.count,
    calls: script.calls.count,
  };
};

describe("pull request watch loop", () => {
  it("treats the first read as the baseline and reports nothing", async () => {
    const result = await runPolls(scriptedGh([pendingChecks, pendingChecks]), [INTERVAL_MS]);

    expect(result.calls).toBe(2);
    expect(result.notifications).toEqual([]);
    expect(result.changes).toBe(2);
  });

  it("reports CI finishing with the pass and fail counts", async () => {
    const finished = snapshotOf({ checks: { total: 3, passed: 2, failed: 1, pending: 0 } });
    const result = await runPolls(scriptedGh([pendingChecks, finished, finished]), [
      INTERVAL_MS,
      INTERVAL_MS,
    ]);

    expect(result.notifications).toEqual([
      {
        label: "CI failed",
        text: "#12: CI finished: 2 passed, 1 failed. Fix the failing checks and push.",
      },
    ]);
  });

  it("reports CI passing with the pass count", async () => {
    const finished = snapshotOf({ checks: { total: 2, passed: 2, failed: 0, pending: 0 } });
    const result = await runPolls(scriptedGh([pendingChecks, finished]), [INTERVAL_MS]);

    expect(result.notifications).toEqual([
      {
        label: "CI passed",
        text: "#12: CI finished: 2 passed. Merge it once it is approved.",
      },
    ]);
  });

  it("reports an approval", async () => {
    const ciPassed = snapshotOf({ checks: { total: 2, passed: 2, failed: 0, pending: 0 } });
    const approved = { ...ciPassed, reviewDecision: "APPROVED" };

    const result = await runPolls(scriptedGh([ciPassed, approved]), [INTERVAL_MS]);
    expect(result.notifications).toEqual([
      { label: "approved", text: "#12: approved. Merge it when you are ready." },
    ]);
  });

  it("reports requested changes", async () => {
    const requested = snapshotOf({ reviewDecision: "CHANGES_REQUESTED" });
    const result = await runPolls(scriptedGh([pendingChecks, requested]), [INTERVAL_MS]);

    expect(result.notifications).toEqual([
      {
        label: "changes requested",
        text: "#12: has changes requested. Address the review comments and push.",
      },
    ]);
  });

  it("reports a new conflict with the base branch", async () => {
    const conflicting = snapshotOf({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" });
    const result = await runPolls(scriptedGh([pendingChecks, conflicting]), [INTERVAL_MS]);

    expect(result.notifications).toEqual([
      {
        label: "conflict",
        text: "#12: now conflicts with its base. Rebase onto the base branch and push.",
      },
    ]);
  });

  it("reports new review comments", async () => {
    const commented = snapshotOf({ comments: 2 });
    const result = await runPolls(scriptedGh([pendingChecks, commented]), [INTERVAL_MS]);

    expect(result.notifications).toEqual([
      { label: "comment", text: "#12: has 2 new comments. Read them before the next push." },
    ]);
  });

  it("reports a merge once and stops watching", async () => {
    const merged = snapshotOf({ state: "MERGED" });
    const result = await runPolls(scriptedGh([pendingChecks, merged, merged]), [
      INTERVAL_MS,
      INTERVAL_MS,
    ]);

    expect(result.notifications).toEqual([
      {
        label: "merged",
        text: "#12: merged. The watch stopped; pull the base branch before you continue.",
      },
    ]);
    expect(result.calls).toBe(2);
    expect(result.entry.status).toBe("stopped");
  });

  it("reports a close once and stops watching", async () => {
    const closed = snapshotOf({ state: "CLOSED" });
    const result = await runPolls(scriptedGh([pendingChecks, closed, closed]), [
      INTERVAL_MS,
      INTERVAL_MS,
    ]);

    expect(result.notifications).toEqual([
      {
        label: "closed",
        text: "#12: closed without merging. The watch stopped; reopen it or open a new pull request.",
      },
    ]);
    expect(result.calls).toBe(2);
    expect(result.entry.status).toBe("stopped");
  });

  it("keeps polling at a longer interval after a rate limit", async () => {
    const rateLimited = new PrWatchGhError({
      kind: "rate-limit",
      message: "gh hit the GitHub rate limit",
    });
    const result = await runPolls(scriptedGh([pendingChecks, rateLimited, pendingChecks]), [
      INTERVAL_MS,
      4 * INTERVAL_MS,
    ]);

    expect(result.notifications).toEqual([
      {
        label: "gh error",
        text: "#12: gh hit the GitHub rate limit. Retrying every 180s.",
      },
    ]);
    expect(result.entry.status).toBe("watching");
    expect(result.entry.intervalMs).toBe(INTERVAL_MS);
    expect(result.calls).toBe(3);
  });

  it("stops watching when gh cannot run at all", async () => {
    const missing = new PrWatchGhError({ kind: "missing", message: "gh is not on PATH" });
    const result = await runPolls(scriptedGh([missing, pendingChecks]), [INTERVAL_MS]);

    expect(result.notifications).toEqual([
      {
        label: "watch stopped",
        text: "#12: gh is not on PATH. The watch stopped; start it again after fixing this.",
      },
    ]);
    expect(result.entry.status).toBe("stopped");
    expect(result.calls).toBe(1);
  });
});
