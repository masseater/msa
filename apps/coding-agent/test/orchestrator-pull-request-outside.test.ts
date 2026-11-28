import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import pullRequestSupport from "./pull-request-support.ts";

const { harness } = orchestratorHarness;
const { completing } = harness;
const { taskStatus } = harness;
const { openedTask, withRemote } = pullRequestSupport;

const stopsWhenTheWorkerMergedItsOwnPullRequest = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, branch, number, taskId } =
          yield* openedTask(remote);
        github.ci.set(yield* github.head(branch), "success");
        const commit = yield* github.mergeOutside(number, "someone-else");
        yield* completing(
          workers[0],
          `merged #${number} myself`,
          () => taskStatus(orchestrator, taskId) === "stopped",
        );
        expect(workers).toHaveLength(1);
        expect(github.merged).toEqual([]);
        const report = reports.at(-1);
        expect(report?.details.status).toBe("stopped");
        expect(report?.text).toContain(`PR #${number}`);
        expect(report?.text).toContain("someone-else");
        expect(report?.text).toContain(commit.slice(0, 12));
      }),
    ),
  );

it(
  "stops the task and reports who merged it when the goal check finds the pull request merged before the harness merged it",
  stopsWhenTheWorkerMergedItsOwnPullRequest,
);

const stopsWhenThePullRequestWasMergedDuringTheReview = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, branch, number, taskId } =
          yield* openedTask(remote);
        github.ci.set(yield* github.head(branch), "success");
        yield* completing(workers[0], "CI is green", () => workers.length === 2);
        const commit = yield* github.mergeOutside(number, "reviewer-account");
        yield* completing(
          workers[1],
          "acceptable",
          () => taskStatus(orchestrator, taskId) === "stopped",
        );
        expect(github.merged).toEqual([]);
        const report = reports.at(-1);
        expect(report?.details.status).toBe("stopped");
        expect(report?.text).toContain("reviewer-account");
        expect(report?.text).toContain(commit.slice(0, 12));
      }),
    ),
  );

it(
  "stops the task and reports who merged it when the pull request was merged while it was under review",
  stopsWhenThePullRequestWasMergedDuringTheReview,
);

const stopsWhenTheWorkerEnabledAutoMerge = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, branch, number, taskId } =
          yield* openedTask(remote);
        github.ci.set(yield* github.head(branch), "success");
        github.enableAutoMerge(number, "worker-account");
        yield* completing(
          workers[0],
          "CI is green",
          () => taskStatus(orchestrator, taskId) === "stopped",
        );
        expect(workers).toHaveLength(1);
        expect(github.merged).toEqual([]);
        expect(reports.at(-1)?.text).toContain("auto-merge enabled by worker-account");
      }),
    ),
  );

it(
  "stops the task and names who enabled it when the goal check finds auto-merge enabled on the pull request",
  stopsWhenTheWorkerEnabledAutoMerge,
);

const stopsWhenAutoMergeWasEnabledDuringTheReview = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, branch, number, taskId } =
          yield* openedTask(remote);
        github.ci.set(yield* github.head(branch), "success");
        yield* completing(workers[0], "CI is green", () => workers.length === 2);
        github.enableAutoMerge(number, "reviewer-account");
        yield* completing(
          workers[1],
          "acceptable",
          () => taskStatus(orchestrator, taskId) === "stopped",
        );
        expect(github.merged).toEqual([]);
        expect(reports.at(-1)?.text).toContain("auto-merge enabled by reviewer-account");
      }),
    ),
  );

it(
  "stops the task instead of merging when auto-merge was enabled on the pull request while it was under review",
  stopsWhenAutoMergeWasEnabledDuringTheReview,
);
