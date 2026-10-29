import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import prWatchLoopSupport from "./pr-watch-loop-support.ts";
const { awaited, runTest } = testing;

const { INTERVAL_MS, pendingChecks, runPolls, scriptedGh, seen, snapshotOf } = prWatchLoopSupport;

const MINUTE = 60_000;

const pastRuns = [
  ...[14, 15, 16, 17, 18, 16, 15, 14, 17, 18, 16, 15, 14, 17, 18, 16, 15, 14, 17, 18].map(
    (minutes) => ({ durationMs: minutes * MINUTE, succeeded: true, workflow: "verify" }),
  ),
  { durationMs: 2 * MINUTE, succeeded: true, workflow: "commits" },
];

const runsOfOtherWorkflows = Array.from({ length: 20 }, () => ({
  durationMs: 2 * MINUTE,
  succeeded: true,
  workflow: "commits",
}));

const running = (minutes: number, usual = "usually 18m") => ({
  label: "status",
  text: `#12: checks running ${minutes}m (verify; ${usual}), mergeable, review required`,
});

const stalled = (minutes: number, usual = "usually 18m") => ({
  label: "status",
  text: `#12: CI stalled ${minutes}m (verify; ${usual}), mergeable, review required — it may be stalled; check the run or push again`,
});

const keepsALongButUsualRunAsRunning = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks], undefined, { runs: [pastRuns] }), [33 * INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([running(5), running(10), running(15), running(21)]);
    }),
  );

const saysCiIsStalledPastTheUsualTime = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks], undefined, { runs: [pastRuns] }), [42 * INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        running(5),
        running(10),
        running(15),
        running(21),
        running(26),
        stalled(31),
      ]);
    }),
  );

const readsPastRunsAgainAfterAFailedRead = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks], undefined, { runs: [undefined, pastRuns] }), [
          INTERVAL_MS,
          41 * INTERVAL_MS,
        ]),
      );

      expect(result.runsCalls).toBe(2);
      expect(seen(result).at(-1)).toEqual(stalled(31));
    }),
  );

const timesANewHeadFromItsOwnStart = () =>
  runTest(
    Effect.gen(function* () {
      const steps = [
        ...Array.from({ length: 20 }, () => pendingChecks),
        snapshotOf({ headRefOid: "new-head-oid" }),
      ];
      const result = yield* awaited(
        runPolls(scriptedGh(steps, undefined, { runs: [pastRuns] }), [52 * INTERVAL_MS]),
      );

      const statuses = seen(result).filter((notification) => notification.label === "status");
      expect(statuses.at(-1)).toEqual(running(21));
      expect(statuses).not.toContainEqual(
        expect.objectContaining({ text: expect.stringContaining("stalled") }),
      );
    }),
  );

const noPastRuns = (timeout: string) => `no past runs; times out at ${timeout}`;

const fallsBackToTheWorkflowTimeoutWithoutPastRuns = () =>
  runTest(
    Effect.gen(function* () {
      const history = { runs: [[]], timeouts: [{ timeoutMs: 20 * MINUTE, workflow: "verify" }] };
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks], undefined, history), [42 * INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        running(5, noPastRuns("20m")),
        running(10, noPastRuns("20m")),
        running(15, noPastRuns("20m")),
        running(21, noPastRuns("20m")),
        running(26, noPastRuns("20m")),
        stalled(31, noPastRuns("20m")),
      ]);
    }),
  );

const judgesAWorkflowWithoutRunsOfItsOwnFromItsTimeout = () =>
  runTest(
    Effect.gen(function* () {
      const history = {
        runs: [runsOfOtherWorkflows],
        timeouts: [{ timeoutMs: 20 * MINUTE, workflow: "verify" }],
      };
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks], undefined, history), [42 * INTERVAL_MS]),
      );

      expect(seen(result)).toEqual([
        running(5, noPastRuns("20m")),
        running(10, noPastRuns("20m")),
        running(15, noPastRuns("20m")),
        running(21, noPastRuns("20m")),
        running(26, noPastRuns("20m")),
        stalled(31, noPastRuns("20m")),
      ]);
    }),
  );

const usesTheDefaultJobTimeoutWithoutWorkflowFiles = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        runPolls(scriptedGh([pendingChecks], undefined, { runs: [[]], timeouts: [] }), [
          7 * INTERVAL_MS,
        ]),
      );

      expect(seen(result)).toEqual([running(5, noPastRuns("6h 0m"))]);
    }),
  );

describe("pull request watch stall check", () => {
  it(
    "keeps a run that takes long but within its past runs as running",
    keepsALongButUsualRunAsRunning,
  );

  it(
    "says CI is stalled once the checks stay pending past 1.5 times their usual duration",
    saysCiIsStalledPastTheUsualTime,
  );

  it(
    "times the checks of a new head from when that head was seen, not from the old head's start",
    timesANewHeadFromItsOwnStart,
  );

  it(
    "reads the past runs again on the next poll after a failed read and then reports a stall",
    readsPastRunsAgainAfterAFailedRead,
  );

  it(
    "judges a stall from the workflow's timeout-minutes when the repository has no past runs",
    fallsBackToTheWorkflowTimeoutWithoutPastRuns,
  );

  it(
    "judges a workflow with no runs of its own from its timeout-minutes, not from other workflows",
    judgesAWorkflowWithoutRunsOfItsOwnFromItsTimeout,
  );

  it(
    "uses GitHub's default job timeout when the repository has no workflow files",
    usesTheDefaultJobTimeoutWithoutWorkflowFiles,
  );
});
