import { Clock, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vite-plus/test";

import { PrWatchGhError, type PrWatchGh } from "../src/core/pr-watch/gh.ts";
import type { PrSnapshot } from "../src/core/pr-watch/snapshot.ts";
import {
  createPrWatchEntry,
  type PrNotification,
  type PrWatchEntry,
  prWatchLoop,
} from "../src/core/pr-watch/watch.ts";

const INTERVAL_MS = 45_000;
const STATUS_INTERVAL_MS = 300_000;

const snapshotOf = (overrides: Partial<PrSnapshot> = {}): PrSnapshot => ({
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "REVIEW_REQUIRED",
  updatedAt: "2024-05-01T00:00:00Z",
  comments: 0,
  checks: { total: 2, passed: 0, failed: 0, pending: 2, pendingNames: ["verify"] },
  baseRefName: "main",
  headRefOid: "head-oid",
  behindBy: undefined,
  ...overrides,
});

const pendingChecks = snapshotOf();

const finishedChecks = snapshotOf({
  checks: { total: 3, passed: 2, failed: 1, pending: 0, pendingNames: [] },
});

const passedChecks = snapshotOf({
  checks: { total: 2, passed: 2, failed: 0, pending: 0, pendingNames: [] },
});

interface ScriptedGh {
  readonly gh: PrWatchGh;
  readonly calls: { count: number };
  readonly behindCalls: { count: number };
}

const scriptedGh = (
  steps: ReadonlyArray<PrSnapshot | PrWatchGhError>,
  behindBy?: number,
): ScriptedGh => {
  const calls = { count: 0 };
  const behindCalls = { count: 0 };
  return {
    calls,
    behindCalls,
    gh: {
      view: () => {
        const step = steps[Math.min(calls.count, steps.length - 1)]!;
        calls.count += 1;
        return step instanceof PrWatchGhError ? Effect.fail(step) : Effect.succeed(step);
      },
      behind: () => {
        behindCalls.count += 1;
        return behindBy === undefined
          ? Effect.fail(new PrWatchGhError({ kind: "other", message: "no compare" }))
          : Effect.succeed(behindBy);
      },
    },
  };
};

interface RunResult {
  readonly entry: PrWatchEntry;
  readonly notifications: PrNotification[];
  readonly changes: number;
  readonly calls: number;
  readonly behindCalls: number;
}

const runPolls = async (script: ScriptedGh, advances: readonly number[]): Promise<RunResult> => {
  const notifications: PrNotification[] = [];
  const changes = { count: 0 };
  const entry = createPrWatchEntry({ number: 12 }, INTERVAL_MS, STATUS_INTERVAL_MS);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* TestClock.make();
        const fiber = yield* prWatchLoop({
          gh: script.gh,
          entry,
          host: {
            notify: (notification) => {
              notifications.push(notification);
            },
            changed: () => {
              changes.count += 1;
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
    ),
  );
  return {
    entry,
    notifications,
    changes: changes.count,
    calls: script.calls.count,
    behindCalls: script.behindCalls.count,
  };
};

const seen = (result: RunResult) =>
  result.notifications.map(({ label, text }) => ({ label, text }));

describe("pull request watch loop", () => {
  it("treats the first read as the baseline and reports nothing", async () => {
    const result = await runPolls(scriptedGh([pendingChecks, pendingChecks]), [INTERVAL_MS]);

    expect(result.calls).toBe(2);
    expect(result.notifications).toEqual([]);
    expect(result.changes).toBe(2);
  });

  it("reports CI finishing with the pass and fail counts", async () => {
    const result = await runPolls(scriptedGh([pendingChecks, finishedChecks, finishedChecks]), [
      INTERVAL_MS,
      INTERVAL_MS,
    ]);

    expect(seen(result)).toEqual([
      {
        label: "CI failed",
        text: "#12: CI finished: 2 passed, 1 failed. Fix the failing checks and push.",
      },
    ]);
    expect(result.notifications[0]?.wake).toBe(true);
  });

  it("reports CI passing with the pass count", async () => {
    const result = await runPolls(scriptedGh([pendingChecks, passedChecks]), [INTERVAL_MS]);

    expect(seen(result)).toEqual([
      { label: "CI passed", text: "#12: CI finished: 2 passed. Merge it once it is approved." },
    ]);
  });

  it("reports an approval", async () => {
    const approved = { ...passedChecks, reviewDecision: "APPROVED" };
    const result = await runPolls(scriptedGh([passedChecks, approved]), [INTERVAL_MS]);

    expect(seen(result)).toEqual([
      { label: "approved", text: "#12: approved. Merge it when you are ready." },
    ]);
  });

  it("reports requested changes", async () => {
    const requested = snapshotOf({ reviewDecision: "CHANGES_REQUESTED" });
    const result = await runPolls(scriptedGh([pendingChecks, requested]), [INTERVAL_MS]);

    expect(seen(result)).toEqual([
      {
        label: "changes requested",
        text: "#12: has changes requested. Address the review comments and push.",
      },
    ]);
  });

  it("reports a new conflict with the base branch", async () => {
    const conflicting = snapshotOf({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" });
    const result = await runPolls(scriptedGh([pendingChecks, conflicting]), [INTERVAL_MS]);

    expect(seen(result)).toEqual([
      {
        label: "conflict",
        text: "#12: now conflicts with its base. Rebase onto the base branch and push.",
      },
    ]);
  });

  it("reports the base moving ahead as its own change", async () => {
    const behind = snapshotOf({ mergeStateStatus: "BEHIND" });
    const result = await runPolls(scriptedGh([pendingChecks, behind], 2), [INTERVAL_MS]);

    expect(seen(result)).toEqual([
      {
        label: "base moved",
        text: "#12: its base moved ahead by 2 commits. Rebase or update the branch; CI does not run until it is up to date.",
      },
    ]);
    expect(result.behindCalls).toBeGreaterThan(0);
  });

  it("reports a base move that only the compare count shows", async () => {
    const unknown = snapshotOf({ mergeStateStatus: "UNKNOWN" });
    const result = await runPolls(scriptedGh([pendingChecks, unknown], 3), [INTERVAL_MS]);

    expect(seen(result)).toEqual([
      {
        label: "base moved",
        text: "#12: its base moved ahead by 3 commits. Rebase or update the branch; CI does not run until it is up to date.",
      },
    ]);
  });

  it("reports new review comments", async () => {
    const commented = snapshotOf({ comments: 2 });
    const result = await runPolls(scriptedGh([pendingChecks, commented]), [INTERVAL_MS]);

    expect(seen(result)).toEqual([
      { label: "comment", text: "#12: has 2 new comments. Read them before the next push." },
    ]);
  });

  it("reports a merge once and stops watching", async () => {
    const merged = snapshotOf({ state: "MERGED" });
    const result = await runPolls(scriptedGh([pendingChecks, merged, merged]), [
      INTERVAL_MS,
      INTERVAL_MS,
    ]);

    expect(seen(result)).toEqual([
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

    expect(seen(result)).toEqual([
      {
        label: "closed",
        text: "#12: closed without merging. The watch stopped; reopen it or open a new pull request.",
      },
    ]);
    expect(result.calls).toBe(2);
    expect(result.entry.status).toBe("stopped");
  });

  it("reports its status when nothing changed for five minutes", async () => {
    const result = await runPolls(scriptedGh([pendingChecks]), [7 * INTERVAL_MS]);

    expect(seen(result)).toEqual([
      { label: "status", text: "#12: checks running (verify), mergeable, review required" },
    ]);
    expect(result.notifications[0]?.wake).toBe(false);
  });

  it("keeps reporting its status every five quiet minutes", async () => {
    const result = await runPolls(scriptedGh([pendingChecks]), [14 * INTERVAL_MS]);

    expect(result.notifications.map((notification) => notification.label)).toEqual([
      "status",
      "status",
    ]);
  });

  it("says CI is stalled when the checks stay pending", async () => {
    const result = await runPolls(scriptedGh([pendingChecks]), [21 * INTERVAL_MS]);

    expect(seen(result)).toEqual([
      { label: "status", text: "#12: checks running (verify), mergeable, review required" },
      {
        label: "status",
        text: "#12: CI stalled 10m (verify), mergeable, review required — it may be stalled; check the run or push again",
      },
      {
        label: "status",
        text: "#12: CI stalled 15m (verify), mergeable, review required — it may be stalled; check the run or push again",
      },
    ]);
  });

  it("reports a base move in its status with how long it has been behind", async () => {
    const behind = snapshotOf({ mergeStateStatus: "BEHIND" });
    const result = await runPolls(scriptedGh([behind], 2), [7 * INTERVAL_MS]);

    expect(seen(result)).toEqual([
      {
        label: "status",
        text: "#12: checks running (verify), base 2 behind for 5m, review required",
      },
    ]);
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

    expect(seen(result)).toEqual([
      { label: "gh error", text: "#12: gh hit the GitHub rate limit. Retrying every 180s." },
    ]);
    expect(result.entry.status).toBe("watching");
    expect(result.entry.intervalMs).toBe(INTERVAL_MS);
    expect(result.calls).toBe(3);
  });

  it("reports its status again after a rate limit clears", async () => {
    const rateLimited = new PrWatchGhError({
      kind: "rate-limit",
      message: "gh hit the GitHub rate limit",
    });
    const result = await runPolls(scriptedGh([pendingChecks, rateLimited, pendingChecks]), [
      INTERVAL_MS,
      4 * INTERVAL_MS,
      7 * INTERVAL_MS,
    ]);

    expect(result.notifications.map((notification) => notification.label)).toEqual([
      "gh error",
      "status",
    ]);
  });

  it("stops watching when gh cannot run at all", async () => {
    const missing = new PrWatchGhError({ kind: "missing", message: "gh is not on PATH" });
    const result = await runPolls(scriptedGh([missing, pendingChecks]), [INTERVAL_MS]);

    expect(seen(result)).toEqual([
      {
        label: "watch stopped",
        text: "#12: gh is not on PATH. The watch stopped; start it again after fixing this.",
      },
    ]);
    expect(result.entry.status).toBe("stopped");
    expect(result.calls).toBe(1);
  });
});
