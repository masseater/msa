import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import prWatchLoopSupport from "./pr-watch-loop-support.ts";

const { awaited, runTest } = testing;

const { INTERVAL_MS, pendingChecks, runPolls, scriptedGh, seen, snapshotOf } = prWatchLoopSupport;

const finishedChecks = snapshotOf({
  checks: { failed: 1, passed: 2, pending: 0, pendingNames: [], total: 3 },
});

const passedChecks = snapshotOf({
  checks: { failed: 0, passed: 2, pending: 0, pendingNames: [], total: 2 },
});

const reportsCiPassingWithThePassCount = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, passedChecks]), [INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        { label: "CI passed", text: "#12: CI finished: 2 passed. Merge it once it is approved." },
      ]);
    }),
  );

const reportsAnApproval = () =>
  runTest(
    Effect.gen(function* () {
      const approved = { ...passedChecks, reviewDecision: "APPROVED" };
      const result = yield* awaited(runPolls(scriptedGh([passedChecks, approved]), [INTERVAL_MS]));

      expect(seen(result)).toEqual([
        { label: "approved", text: "#12: approved. Merge it when you are ready." },
      ]);
    }),
  );

const reportsRequestedChanges = () =>
  runTest(
    Effect.gen(function* () {
      const requested = snapshotOf({ reviewDecision: "CHANGES_REQUESTED" });
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, requested]), [INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        {
          label: "changes requested",
          text: "#12: has changes requested. Address the review comments and push.",
        },
      ]);
    }),
  );

const reportsANewConflictWithTheBase = () =>
  runTest(
    Effect.gen(function* () {
      const conflicting = snapshotOf({ mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" });
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, conflicting]), [INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        {
          label: "conflict",
          text: "#12: now conflicts with its base. Rebase onto the base branch and push.",
        },
      ]);
    }),
  );

const reportsABaseMoveThatOnlyThe = () =>
  runTest(
    Effect.gen(function* () {
      const unknown = snapshotOf({ mergeStateStatus: "UNKNOWN" });
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, unknown], 3), [INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        {
          label: "base moved",
          text: "#12: its base moved ahead by 3 commits. Rebase or update the branch; CI does not run until it is up to date.",
        },
      ]);
    }),
  );

const reportsNewReviewComments = () =>
  runTest(
    Effect.gen(function* () {
      const commented = snapshotOf({ comments: 2 });
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, commented]), [INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        { label: "comment", text: "#12: has 2 new comments. Read them before the next push." },
      ]);
    }),
  );

const treatsTheFirstReadAsTheBaseline = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, pendingChecks]), [INTERVAL_MS]),
      );

      expect(result.calls).toBe(2);
      expect(result.notifications).toEqual([]);
      expect(result.changes).toBe(2);
    }),
  );

describe("pull request watch loop", () => {
  it("treats the first read as the baseline and reports nothing", treatsTheFirstReadAsTheBaseline);
});

const reportsCiFinishingWithThePassAnd = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, finishedChecks, finishedChecks]), [
          INTERVAL_MS,
          INTERVAL_MS,
        ]),
      );

      expect(seen(result)).toEqual([
        {
          label: "CI failed",
          text: "#12: CI finished: 2 passed, 1 failed. Fix the failing checks and push.",
        },
      ]);
      expect(result.notifications[0]?.wake).toBe(true);
    }),
  );

describe("pull request watch loop", () => {
  it("reports CI finishing with the pass and fail counts", reportsCiFinishingWithThePassAnd);
});

const measuresHowLongTheChecksWerePending = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, pendingChecks, finishedChecks]), [
          INTERVAL_MS,
          INTERVAL_MS,
        ]),
      );

      expect(result.notifications.map((notification) => notification.ci)).toEqual([
        { conclusion: "failed", durationMs: 2 * INTERVAL_MS },
      ]);
    }),
  );

describe("pull request watch loop", () => {
  it(
    "measures how long the checks were pending when CI finishes",
    measuresHowLongTheChecksWerePending,
  );

  it("reports CI passing with the pass count", reportsCiPassingWithThePassCount);

  it("reports an approval", reportsAnApproval);

  it("reports requested changes", reportsRequestedChanges);
});

const reportsTheBaseMovingAheadAsIts = () =>
  runTest(
    Effect.gen(function* () {
      const behind = snapshotOf({ mergeStateStatus: "BEHIND" });
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks, behind], 2), [INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        {
          label: "base moved",
          text: "#12: its base moved ahead by 2 commits. Rebase or update the branch; CI does not run until it is up to date.",
        },
      ]);
      expect(result.behindCalls).toBeGreaterThan(0);
    }),
  );

describe("pull request watch loop", () => {
  it("reports a new conflict with the base branch", reportsANewConflictWithTheBase);

  it("reports the base moving ahead as its own change", reportsTheBaseMovingAheadAsIts);

  it("reports a base move that only the compare count shows", reportsABaseMoveThatOnlyThe);
});

describe("pull request watch loop", () => {
  it("reports new review comments", reportsNewReviewComments);
});
