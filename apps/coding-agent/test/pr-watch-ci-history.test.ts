import { describe, expect, it } from "vite-plus/test";

import ciHistory from "../src/core/pr-watch/ci-history.ts";

const { stallLimit } = ciHistory;

const MINUTE = 60_000;

const runsOf = (workflow: string, minutes: readonly number[], succeeded = true) =>
  minutes.map((minute) => ({ durationMs: minute * MINUTE, succeeded, workflow }));

const takesTheNinetiethPercentileOfTheWorkflowsOwnRuns = () => {
  const runs = [
    ...runsOf("verify", [10, 11, 12, 13, 14, 15, 16, 17, 18, 40]),
    ...runsOf("commits", [1, 2]),
  ];

  expect(stallLimit(runs, ["verify"])).toEqual({
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

  expect(stallLimit(runs, ["verify"])?.typicalMs).toBe(4 * MINUTE);
};

const leavesFailedRunsOutWhileSuccessfulOnesExist = () => {
  const runs = [...runsOf("verify", [60], false), ...runsOf("verify", [10])];

  expect(stallLimit(runs, ["verify"])?.typicalMs).toBe(10 * MINUTE);
};

const usesFailedRunsWhenNoRunSucceeded = () => {
  const runs = runsOf("verify", [12], false);

  expect(stallLimit(runs, ["verify"])?.typicalMs).toBe(12 * MINUTE);
};

const fallsBackToEveryWorkflowWhenThePendingOneHasNoRuns = () => {
  const runs = runsOf("verify", [10, 20]);

  expect(stallLimit(runs, ["deploy"])?.typicalMs).toBe(20 * MINUTE);
};

const waitsForTheSlowestPendingWorkflow = () => {
  const runs = [...runsOf("verify", [20]), ...runsOf("commits", [2])];

  expect(stallLimit(runs, ["commits", "verify"])?.typicalMs).toBe(20 * MINUTE);
};

const judgesNothingWithoutPastRuns = () => {
  expect(stallLimit([], ["verify"])).toBeUndefined();
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
    "falls back to every workflow's runs when the pending workflow has none",
    fallsBackToEveryWorkflowWhenThePendingOneHasNoRuns,
  );

  it("waits for the slowest pending workflow", waitsForTheSlowestPendingWorkflow);

  it("judges nothing without past runs", judgesNothingWithoutPastRuns);
});
