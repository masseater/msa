import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import PrWatchGhError from "../src/core/pr-watch/pr-watch-gh-error.ts";
import prWatchLoopSupport from "./pr-watch-loop-support.ts";
const { awaited, runTest } = testing;

const { INTERVAL_MS, pendingChecks, runPolls, scriptedGh, seen, snapshotOf } = prWatchLoopSupport;

const saysCiIsStalledWhenTheChecks = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(runPolls(scriptedGh([pendingChecks]), [21 * INTERVAL_MS]));

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
    }),
  );

const reportsABaseMoveInItsStatus = () =>
  runTest(
    Effect.gen(function* () {
      const behind = snapshotOf({ mergeStateStatus: "BEHIND" });
      const result = yield* awaited(runPolls(scriptedGh([behind], 2), [7 * INTERVAL_MS]));

      expect(seen(result)).toEqual([
        {
          label: "status",
          text: "#12: checks running (verify), base 2 behind for 5m, review required",
        },
      ]);
    }),
  );

const reportsAMergeOnceAndStopsWatching = () =>
  runTest(
    Effect.gen(function* () {
      const merged = snapshotOf({ state: "MERGED" });
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, merged, merged]), [INTERVAL_MS, INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        {
          label: "merged",
          text: "#12: merged. The watch stopped; pull the base branch before you continue.",
        },
      ]);
      expect(result.calls).toBe(2);
      expect(result.entry.status).toBe("stopped");
    }),
  );

describe("pull request watch loop", () => {
  it("reports a merge once and stops watching", reportsAMergeOnceAndStopsWatching);
});

const reportsACloseOnceAndStopsWatching = () =>
  runTest(
    Effect.gen(function* () {
      const closed = snapshotOf({ state: "CLOSED" });
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, closed, closed]), [INTERVAL_MS, INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        {
          label: "closed",
          text: "#12: closed without merging. The watch stopped; reopen it or open a new pull request.",
        },
      ]);
      expect(result.calls).toBe(2);
      expect(result.entry.status).toBe("stopped");
    }),
  );

describe("pull request watch loop", () => {
  it("reports a close once and stops watching", reportsACloseOnceAndStopsWatching);
});

const reportsItsStatusWhenNothingChangedFor = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(runPolls(scriptedGh([pendingChecks]), [7 * INTERVAL_MS]));

      expect(seen(result)).toEqual([
        { label: "status", text: "#12: checks running (verify), mergeable, review required" },
      ]);
      expect(result.notifications[0]?.wake).toBe(false);
    }),
  );

const keepsReportingItsStatusEveryFiveQuiet = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(runPolls(scriptedGh([pendingChecks]), [14 * INTERVAL_MS]));

      expect(result.notifications.map((notification) => notification.label)).toEqual([
        "status",
        "status",
      ]);
    }),
  );

describe("pull request watch loop", () => {
  it(
    "reports its status when nothing changed for five minutes",
    reportsItsStatusWhenNothingChangedFor,
  );

  it("keeps reporting its status every five quiet minutes", keepsReportingItsStatusEveryFiveQuiet);
});

describe("pull request watch loop", () => {
  it("says CI is stalled when the checks stay pending", saysCiIsStalledWhenTheChecks);

  it(
    "reports a base move in its status with how long it has been behind",
    reportsABaseMoveInItsStatus,
  );
});

const keepsPollingAtALongerIntervalAfter = () =>
  runTest(
    Effect.gen(function* () {
      const rateLimited = new PrWatchGhError({
        kind: "rate-limit",
        message: "gh hit the GitHub rate limit",
      });
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, rateLimited, pendingChecks]), [
          INTERVAL_MS,
          4 * INTERVAL_MS,
        ]),
      );

      expect(seen(result)).toEqual([
        { label: "gh error", text: "#12: gh hit the GitHub rate limit. Retrying every 180s." },
      ]);
      expect(result.entry.status).toBe("watching");
      expect(result.entry.intervalMs).toBe(INTERVAL_MS);
      expect(result.calls).toBe(3);
    }),
  );

describe("pull request watch loop", () => {
  it("keeps polling at a longer interval after a rate limit", keepsPollingAtALongerIntervalAfter);
});

const reportsItsStatusAgainAfterARate = () =>
  runTest(
    Effect.gen(function* () {
      const rateLimited = new PrWatchGhError({
        kind: "rate-limit",
        message: "gh hit the GitHub rate limit",
      });
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, rateLimited, pendingChecks]), [
          INTERVAL_MS,
          4 * INTERVAL_MS,
          7 * INTERVAL_MS,
        ]),
      );

      expect(result.notifications.map((notification) => notification.label)).toEqual([
        "gh error",
        "status",
      ]);
    }),
  );

describe("pull request watch loop", () => {
  it("reports its status again after a rate limit clears", reportsItsStatusAgainAfterARate);
});

const stopsWatchingWhenGhCannotRunAt = () =>
  runTest(
    Effect.gen(function* () {
      const missing = new PrWatchGhError({ kind: "missing", message: "gh is not on PATH" });
      const result = yield* awaited(runPolls(scriptedGh([missing, pendingChecks]), [INTERVAL_MS]));

      expect(seen(result)).toEqual([
        {
          label: "watch stopped",
          text: "#12: gh is not on PATH. The watch stopped; start it again after fixing this.",
        },
      ]);
      expect(result.entry.status).toBe("stopped");
      expect(result.calls).toBe(1);
    }),
  );

describe("pull request watch loop", () => {
  it("stops watching when gh cannot run at all", stopsWatchingWhenGhCannotRunAt);
});
