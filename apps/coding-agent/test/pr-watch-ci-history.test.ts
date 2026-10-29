import { describe, expect, it } from "vite-plus/test";

import ciHistory from "../src/core/pr-watch/ci-history.ts";
import type ciHistoryTypes from "../src/core/pr-watch/ci-history.types.ts";

const { stallLimit, workflowTimeout } = ciHistory;

const limitOf = (
  runs: readonly ciHistoryTypes.CiRun[],
  workflows: readonly string[],
  timeouts: readonly ciHistoryTypes.WorkflowTimeout[] = [],
) => stallLimit({ runs, timeouts }, workflows);

const MINUTE = 60_000;

const typicalOf = (limit: ciHistoryTypes.CiStallLimit) =>
  limit.basis === "history" ? limit.typicalMs : undefined;

const runsOf = (workflow: string, minutes: readonly number[], succeeded = true) =>
  minutes.map((minute) => ({ durationMs: minute * MINUTE, succeeded, workflow }));

const takesTheNinetiethPercentileOfTheWorkflowsOwnRuns = () => {
  const runs = [
    ...runsOf("verify", [10, 11, 12, 13, 14, 15, 16, 17, 18, 40]),
    ...runsOf("commits", [1, 2]),
  ];

  expect(limitOf(runs, ["verify"])).toEqual({
    basis: "history",
    limitMs: 27 * MINUTE,
    runs: 10,
    typicalMs: 18 * MINUTE,
  });
};

const usesOnlyTheMostRecentRuns = () => {
  const runs = [
    ...runsOf(
      "verify",
      Array.from({ length: 20 }, () => 4),
    ),
    ...runsOf("verify", [30]),
  ];

  expect(typicalOf(limitOf(runs, ["verify"]))).toBe(4 * MINUTE);
};

const leavesFailedRunsOutWhileSuccessfulOnesExist = () => {
  const runs = [...runsOf("verify", [60], false), ...runsOf("verify", [10])];

  expect(typicalOf(limitOf(runs, ["verify"]))).toBe(10 * MINUTE);
};

const usesFailedRunsWhenNoRunSucceeded = () => {
  const runs = runsOf("verify", [12], false);

  expect(typicalOf(limitOf(runs, ["verify"]))).toBe(12 * MINUTE);
};

const usesTheTimeoutOfAPendingWorkflowWithoutRunsOfItsOwn = () => {
  const runs = runsOf("commits", [1, 2]);
  const timeouts = [{ timeoutMs: 20 * MINUTE, workflow: "verify" }];

  expect(limitOf(runs, ["verify"], timeouts)).toEqual({
    basis: "timeout",
    limitMs: 30 * MINUTE,
    timeoutMs: 20 * MINUTE,
  });
  expect(limitOf(runs, ["commits", "verify"], timeouts)).toMatchObject({ basis: "timeout" });
};

const prefersTheWorkflowsOwnSuccessfulRuns = () => {
  const runs = [...runsOf("verify", [12], false), ...runsOf("commits", [2])];

  expect(typicalOf(limitOf(runs, ["verify"]))).toBe(12 * MINUTE);
};

const waitsForTheSlowestPendingWorkflow = () => {
  const runs = [...runsOf("verify", [20]), ...runsOf("commits", [2])];

  expect(typicalOf(limitOf(runs, ["commits", "verify"]))).toBe(20 * MINUTE);
};

const fallsBackToTheWorkflowTimeoutWithoutPastRuns = () => {
  const timeouts = [
    { timeoutMs: 20 * MINUTE, workflow: "verify" },
    { timeoutMs: 45 * MINUTE, workflow: "release" },
  ];

  expect(limitOf([], ["verify"], timeouts)).toEqual({
    basis: "timeout",
    limitMs: 30 * MINUTE,
    timeoutMs: 20 * MINUTE,
  });
  expect(limitOf([], ["unknown"], timeouts)).toMatchObject({ timeoutMs: 45 * MINUTE });
  expect(limitOf([], ["verify"], [])).toMatchObject({ timeoutMs: 360 * MINUTE });
};

const addsUpTimeoutsAlongTheLongestChainOfNeeds = () => {
  const yaml = [
    "name: verify",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 10",
    "  test:",
    "    needs: build",
    "    timeout-minutes: 15",
    "  lint:",
    "    timeout-minutes: 5",
    "  report:",
    "    needs: [test, lint]",
    "    timeout-minutes: 2",
  ].join("\n");

  expect(workflowTimeout(".github/workflows/verify.yml", yaml)).toEqual({
    timeoutMs: 27 * MINUTE,
    workflow: "verify",
  });
};

const usesTheDefaultJobTimeoutWhereTimeoutMinutesIsMissing = () => {
  const yaml = [
    "on: push",
    "jobs:",
    "  build:",
    "    timeout-minutes: ${{ inputs.minutes }}",
    "  deploy:",
    "    needs: build",
    "    timeout-minutes: 5",
  ].join("\n");

  expect(workflowTimeout(".github/workflows/deploy.yml", yaml)).toEqual({
    timeoutMs: 365 * MINUTE,
    workflow: ".github/workflows/deploy.yml",
  });
  expect(workflowTimeout(".github/workflows/broken.yml", "jobs: [")).toBeUndefined();
};

describe("CI stall limit from past runs", () => {
  it(
    "takes the 90th percentile of the workflow's own runs and allows 1.5 times it",
    takesTheNinetiethPercentileOfTheWorkflowsOwnRuns,
  );

  it("uses only the 20 most recent runs", usesOnlyTheMostRecentRuns);

  it(
    "leaves failed runs out while successful ones exist",
    leavesFailedRunsOutWhileSuccessfulOnesExist,
  );

  it("uses failed runs when no run succeeded", usesFailedRunsWhenNoRunSucceeded);

  it(
    "uses the timeout-minutes of a pending workflow that has no runs of its own",
    usesTheTimeoutOfAPendingWorkflowWithoutRunsOfItsOwn,
  );

  it(
    "uses a workflow's failed runs when only other workflows have successful ones",
    prefersTheWorkflowsOwnSuccessfulRuns,
  );

  it("waits for the slowest pending workflow", waitsForTheSlowestPendingWorkflow);

  it(
    "falls back to the workflow's timeout-minutes, or GitHub's 360-minute default, without past runs",
    fallsBackToTheWorkflowTimeoutWithoutPastRuns,
  );

  it(
    "adds up timeout-minutes along the longest chain of needs",
    addsUpTimeoutsAlongTheLongestChainOfNeeds,
  );

  it(
    "uses the default job timeout where timeout-minutes is missing or an expression",
    usesTheDefaultJobTimeoutWhereTimeoutMinutesIsMissing,
  );
});
