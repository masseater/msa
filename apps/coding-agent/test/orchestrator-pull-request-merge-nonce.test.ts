import testing from "@msa/testing";
import { Deferred, Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { dirnameOf, joinPath } = testing;
const { setup, taskStatus, waitFor } = orchestratorHarness.harness;
const { cleanedUp, reviewed, withRemote } = pullRequestSupport;
const { runCommand } = worktreeSupport;

type Run = ReturnType<typeof setup>;

const isSettled = (orchestrator: Run["orchestrator"], taskId: string) =>
  !["running", "waiting"].includes(taskStatus(orchestrator, taskId) ?? "");

const passAll = (orchestrator: Run["orchestrator"], workers: Run["workers"], taskId: string) =>
  Effect.gen(function* () {
    for (;;) {
      yield* waitFor(
        () => workers.some((worker) => worker.isStreaming) || isSettled(orchestrator, taskId),
      );
      const turn = workers.find((worker) => worker.isStreaming);
      if (turn === undefined) return;
      turn.complete("acceptable");
      yield* waitFor(() => !turn.isStreaming);
    }
  });

const UNANSWERED = { code: 1, stderr: "connection reset by peer", stdout: "" };

const completesWhenAnUnansweredMergeIsTheHarnesss = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, branch, head, number, taskId, worktree } =
          yield* reviewed(remote);
        github.mergeAnswer = { code: 1, stderr: "request timed out", stdout: "" };
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) !== "running");
        expect(taskStatus(orchestrator, taskId)).toBe("completed");
        expect(github.merged).toMatchObject([{ number, sha: head }]);
        expect(reports.at(-1)?.details.status).toBe("completed");
        expect(yield* cleanedUp(remote, worktree, branch)).toEqual({
          local: false,
          remote: false,
          worktree: false,
        });
      }),
    ),
  );

it(
  "completes the task when the harness's merge request gets no answer and the merge commit carries the harness's trailer",
  completesWhenAnUnansweredMergeIsTheHarnesss,
);

const stopsWhenAnUnansweredMergeIsSomeoneElses = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, head, number, taskId } = yield* reviewed(remote);
        let commit = "";
        github.mergeRefusal = UNANSWERED;
        github.beforeMerge = Effect.gen(function* () {
          github.beforeMerge = undefined;
          commit = yield* github.mergeOutside(number, "harness");
        });
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) !== "running");
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        expect(github.pulls[0]).toMatchObject({ head, state: "MERGED" });
        const stopped = reports.at(-1)?.text ?? "";
        expect(stopped).toContain(commit.slice(0, 12));
        expect(stopped).toContain("under the account harness");
        expect(stopped).toContain("can be the account the harness itself uses");
        expect(stopped).toContain("judged from its own record");
        expect(stopped).toContain("does not carry the trailer Msa-Merge: ");
      }),
    ),
  );

it(
  "stops the task, naming who merged it, when the harness's merge request gets no answer and the same head is merged outside the harness under the harness's own account",
  stopsWhenAnUnansweredMergeIsSomeoneElses,
);

const reopened = (remote: Parameters<Parameters<typeof withRemote>[0]>[0], path: string) =>
  setup({
    cwd: remote.repository,
    databasePath: path,
    pollIntervalMs: 20,
    runCommand,
    runGh: remote.github.runGh,
  });

const settlesAfterACrash = (outside: boolean) =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const databasePath = joinPath(dirnameOf(remote.repository), "orchestrator.db");
        const first = yield* reviewed(remote, { databasePath });
        const crashed = yield* Deferred.make<void>();
        const crash = Effect.gen(function* () {
          first.orchestrator.database.close();
          yield* Deferred.succeed(crashed, undefined);
          return yield* Effect.never;
        });
        if (outside) {
          github.beforeMerge = Effect.gen(function* () {
            github.beforeMerge = undefined;
            yield* github.mergeOutside(first.number, "harness");
            return yield* crash;
          });
        } else {
          github.afterMerge = Effect.suspend(() => {
            github.afterMerge = undefined;
            return crash;
          });
        }
        first.workers[1]!.complete("acceptable");
        yield* Deferred.await(crashed);
        expect(github.pulls[0]?.state).toBe("MERGED");

        const second = reopened(remote, databasePath);
        yield* passAll(second.orchestrator, second.workers, first.taskId);
        return { reports: second.reports, status: taskStatus(second.orchestrator, first.taskId) };
      }),
    ),
  );

it("completes the task after a crash right after its own merge landed, once msa reopens", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const settled = yield* Effect.promise(() => settlesAfterACrash(false));
      expect(settled.status).toBe("completed");
      expect(settled.reports.at(-1)?.details.status).toBe("completed");
    }),
  ));

it("stops the task after a crash while its merge request was in flight and the pull request was merged outside the harness, once msa reopens", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const settled = yield* Effect.promise(() => settlesAfterACrash(true));
      expect(settled.status).toBe("stopped");
      const stopped = settled.reports.at(-1)?.text ?? "";
      expect(stopped).toContain("does not carry the trailer Msa-Merge: ");
    }),
  ));

const holdsBackWhenTheMergeCommitCannotBeRead = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, taskId } = yield* reviewed(remote);
        github.mergeAnswer = { code: 1, stderr: "request timed out", stdout: "" };
        github.commitRefusal = { code: 1, stderr: "gh: Server Error (HTTP 502)", stdout: "" };
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) !== "running");
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        const stopped = reports.at(-1)?.text ?? "";
        expect(stopped).toContain("HTTP 502");
        expect(stopped).toContain("has not judged the merge to be someone else's");
        expect(stopped).not.toContain("judged from its own record");

        github.commitRefusal = undefined;
        yield* Effect.promise(() => orchestrator.rerun(taskId));
        yield* passAll(orchestrator, workers, taskId);
        expect(taskStatus(orchestrator, taskId)).toBe("completed");
      }),
    ),
  );

it(
  "does not judge the harness's own merge as someone else's when the merge commit cannot be read, and completes it on a rerun",
  holdsBackWhenTheMergeCommitCannotBeRead,
);
