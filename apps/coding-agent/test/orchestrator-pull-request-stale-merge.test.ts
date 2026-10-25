import { Deferred, Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import pullRequestSupport from "./pull-request-support.ts";

const { taskStatus, waitFor } = orchestratorHarness.harness;
const { cleanedUp, commitAndPush, reviewed, withRemote } = pullRequestSupport;

type Remote = Parameters<Parameters<typeof withRemote>[0]>[0];

const UNREADABLE = { code: 1, stderr: "gh: connection reset", stdout: "" };

type Workers = Effect.Success<ReturnType<typeof reviewed>>["workers"];

function nextWorker(workers: Workers, after: number) {
  return Effect.map(
    waitFor(() => workers.length > after),
    () => workers.at(-1)!,
  );
}

function rerun(run: Effect.Success<ReturnType<typeof reviewed>>) {
  return Effect.gen(function* () {
    const before = run.workers.length;
    yield* Effect.promise(() => run.orchestrator.rerun(run.taskId));
    return yield* nextWorker(run.workers, before);
  });
}

function stoppedWhileGhReportedAMergeThatDidNotLand(remote: Remote) {
  return Effect.gen(function* () {
    const { github } = remote;
    const run = yield* reviewed(remote);
    const merging = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();
    github.beforeMerge = Effect.andThen(Deferred.succeed(merging, undefined), Deferred.await(gate));
    run.workers[1]!.complete("acceptable");
    yield* Deferred.await(merging);
    yield* Effect.promise(() => run.orchestrator.stop(run.taskId));
    const answered = github.answered;
    github.beforeMerge = undefined;
    github.mergeRefusal = { code: 0, stderr: "", stdout: "" };
    github.unavailable = UNREADABLE;
    yield* Deferred.succeed(gate, undefined);
    yield* waitFor(() => github.answered >= answered + 3);
    github.mergeRefusal = undefined;
    github.unavailable = undefined;
    expect(github.merged).toEqual([]);
    expect(taskStatus(run.orchestrator, run.taskId)).toBe("stopped");
    return { ...run, worker: yield* rerun(run) };
  });
}

const stopsWhenAnotherHeadIsMergedOutsideAfterAnUnconfirmedMerge = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, worker, branch, number, taskId } =
          yield* stoppedWhileGhReportedAMergeThatDidNotLand(remote);
        const count = workers.length;
        yield* commitAndPush(worker.cwd, "more.txt", branch);
        github.ci.set(yield* github.head(branch), "success");
        const commit = yield* github.mergeOutside(number, "someone-else");
        worker.complete(`pushed and merged #${number}`);
        yield* waitFor(() => reports.at(-1)?.text.includes("someone-else") === true);
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        expect(workers).toHaveLength(count);
        expect(github.merged).toEqual([]);
        expect(reports.at(-1)?.text).toContain(commit.slice(0, 12));
      }),
    ),
  );

it(
  "stops the task when, after a merge gh reported but no read confirmed, the worker pushes another head and it is merged outside the harness before any read sees it open",
  stopsWhenAnotherHeadIsMergedOutsideAfterAnUnconfirmedMerge,
);

const stopsWhenTheSameHeadIsMergedOutsideAfterItReadAsOpen = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, worker, number, taskId } =
          yield* stoppedWhileGhReportedAMergeThatDidNotLand(remote);
        const count = workers.length;
        worker.complete("nothing left to change");
        const reviewer = yield* nextWorker(workers, count);
        const commit = yield* github.mergeOutside(number, "reviewer-account");
        reviewer.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "stopped");
        expect(github.merged).toEqual([]);
        expect(reports.at(-1)?.text).toContain("reviewer-account");
        expect(reports.at(-1)?.text).toContain(commit.slice(0, 12));
      }),
    ),
  );

it(
  "stops the task when, after a merge gh reported but no read confirmed, the pull request reads as open and is then merged outside the harness at the head the harness had tried",
  stopsWhenTheSameHeadIsMergedOutsideAfterItReadAsOpen,
);

const completesWhenGitHubConfirmsTheMergeButItCannotBeRead = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, branch, head, number, taskId, worktree } =
          yield* reviewed(remote);
        let unreadFrom = 0;
        github.afterMerge = Effect.sync(() => {
          github.afterMerge = undefined;
          github.unavailable = UNREADABLE;
          unreadFrom = github.calls;
        });
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) !== "running");
        expect(github.calls).toBeGreaterThan(unreadFrom);
        github.unavailable = undefined;
        expect(taskStatus(orchestrator, taskId)).toBe("completed");
        expect(github.merged).toMatchObject([{ number, sha: head }]);
        expect(reports.at(-1)?.text).toContain(github.pulls[0]!.mergedBy!.commit.slice(0, 12));
        expect(yield* cleanedUp(remote, worktree, branch)).toEqual({
          local: false,
          remote: false,
          worktree: false,
        });
      }),
    ),
  );

it(
  "completes the task and cleans up when GitHub confirms the harness's merge with its merge commit but the pull request cannot be read back",
  completesWhenGitHubConfirmsTheMergeButItCannotBeRead,
);
