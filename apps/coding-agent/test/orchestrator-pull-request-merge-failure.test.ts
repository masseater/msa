import { Deferred, Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import pullRequestSupport from "./pull-request-support.ts";

const { completing, taskStatus, waitFor } = orchestratorHarness.harness;
const { acceptedMerge, advanceMain, cleanedUp, reviewed, reviewedScenario, withRemote } =
  pullRequestSupport;

const sendsBackWhenMainMovesDuringTheMerge = acceptedMerge({
  check: ({ orchestrator, workers, taskId, github }) =>
    Effect.sync(() => {
      expect(github.merged).toEqual([]);
      expect(taskStatus(orchestrator, taskId)).toBe("running");
      expect(workers[2]!.prompts.join("\n")).toContain("behind main");
    }),
  prepare: ({ github, remote: { origin } }) => {
    github.beforeMerge = Effect.suspend(() => {
      github.beforeMerge = undefined;
      return advanceMain(origin, "moved.txt");
    });
  },
  until: ({ workers }) => workers.length === 3,
});

it(
  "sends the task back to the worker, as before the merge, when gh pr merge fails because the base moved and the pull request reads back as behind",
  sendsBackWhenMainMovesDuringTheMerge,
);

const stopsWithTheReasonWhenTheMergeIsRefused = acceptedMerge({
  check: ({ reports, workers }) =>
    Effect.sync(() => {
      expect(workers).toHaveLength(2);
      expect(reports.at(-1)?.text).toContain("merging is blocked by a ruleset");
    }),
  prepare: ({ github }) => {
    github.mergeRefusal = { code: 1, stderr: "merging is blocked by a ruleset", stdout: "" };
  },
  until: ({ orchestrator, taskId }) => taskStatus(orchestrator, taskId) === "stopped",
});

it(
  "stops the task with gh's reason when the merge is refused and the pull request is neither merged nor behind",
  stopsWithTheReasonWhenTheMergeIsRefused,
);

const completesWhenTheRunEndsMidMerge = reviewedScenario((run) =>
  Effect.gen(function* () {
    const { github, remote } = run;
    const { orchestrator, reports, workers, branch, number, taskId, worktree } = run;
    const merging = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();
    github.beforeMerge = Effect.andThen(Deferred.succeed(merging, undefined), Deferred.await(gate));
    workers[1]!.complete("acceptable");
    yield* Deferred.await(merging);
    const stopping = orchestrator.stop(taskId);
    yield* Deferred.succeed(gate, undefined);
    yield* Effect.promise(() => stopping);
    yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
    expect(github.merged).toMatchObject([{ number }]);
    expect(reports.at(-1)?.details.status).toBe("completed");
    expect(yield* cleanedUp(remote, worktree, branch)).toEqual({
      local: false,
      remote: false,
      worktree: false,
    });
  }),
);

it(
  "completes the task and cleans up when its run is stopped while gh pr merge is in flight and the merge lands",
  completesWhenTheRunEndsMidMerge,
);

const completesWhenTheRunEndsRightAfterTheMerge = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, workers, branch, number, taskId, worktree } = yield* reviewed(
          remote,
          { runPollMs: 60_000 },
        );
        let stopping: Promise<unknown> | undefined;
        const unsubscribe = orchestrator.onChange(() => {
          const task = orchestrator.snapshot.tasks.find((candidate) => candidate.id === taskId);
          if (stopping === undefined && task?.pullRequest?.state === "MERGED") {
            stopping = orchestrator.stop(taskId);
          }
        });
        yield* completing(workers[1], "acceptable", () => stopping !== undefined);
        yield* Effect.promise(() => stopping!);
        unsubscribe();
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
        expect(github.merged).toMatchObject([{ number }]);
        expect(yield* cleanedUp(remote, worktree, branch)).toEqual({
          local: false,
          remote: false,
          worktree: false,
        });
      }),
    ),
  );

it(
  "completes the task and cleans up when its run is stopped right after GitHub reports the merge, before the harness settles it",
  completesWhenTheRunEndsRightAfterTheMerge,
);

const stopsWhenMergedOutsideAfterAFailedMerge = acceptedMerge({
  check: ({ orchestrator, reports, workers, number, taskId, github }) =>
    Effect.gen(function* () {
      const commit = yield* github.mergeOutside(number, "someone-else");
      yield* completing(
        workers[2],
        "rebased",
        () => taskStatus(orchestrator, taskId) === "stopped",
      );
      expect(github.merged).toEqual([]);
      expect(reports.at(-1)?.text).toContain("someone-else");
      expect(reports.at(-1)?.text).toContain(commit.slice(0, 12));
    }),
  prepare: ({ github, remote: { origin } }) => {
    github.beforeMerge = Effect.suspend(() => {
      github.beforeMerge = undefined;
      return advanceMain(origin, "moved.txt");
    });
  },
  until: ({ workers }) => workers.length === 3,
});

it(
  "stops the task when the harness's merge failed, the task went back to the worker, and the pull request was then merged outside the harness at the head the harness had tried",
  stopsWhenMergedOutsideAfterAFailedMerge,
);
