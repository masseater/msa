import { Deferred, Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import pullRequestSupport from "./pull-request-support.ts";

const { taskStatus, waitFor } = orchestratorHarness.harness;
const { cleanedUp, commitAndPush, reviewed, withRemote } = pullRequestSupport;

const stopsWhenAnotherHeadIsMergedWhileTheHarnessMerges = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, branch, number, taskId, worktree } =
          yield* reviewed(remote);
        let commit = "";
        github.beforeMerge = Effect.gen(function* () {
          github.beforeMerge = undefined;
          yield* Effect.orDie(commitAndPush(worktree, "more.txt", branch));
          github.ci.set(yield* github.head(branch), "success");
          commit = yield* github.mergeOutside(number, "someone-else");
        });
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) !== "running");
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        expect(github.merged).toEqual([]);
        expect(reports.at(-1)?.text).toContain("someone-else");
        expect(reports.at(-1)?.text).toContain(commit.slice(0, 12));
      }),
    ),
  );

it(
  "stops the task when another head is pushed and merged outside the harness while the harness merges the reviewed head",
  stopsWhenAnotherHeadIsMergedWhileTheHarnessMerges,
);

const completesWhenTheTaskIsReadWhileTheHarnessMerges = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, workers, branch, head, number, taskId, worktree } =
          yield* reviewed(remote);
        github.beforeMerge = Effect.gen(function* () {
          github.beforeMerge = undefined;
          const view = yield* Effect.promise(() => orchestrator.read(taskId));
          expect(view.pullRequest?.state).toBe("OPEN");
        });
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) !== "running");
        expect(taskStatus(orchestrator, taskId)).toBe("completed");
        expect(github.merged).toMatchObject([{ number, sha: head }]);
        expect(yield* cleanedUp(remote, worktree, branch)).toEqual({
          local: false,
          remote: false,
          worktree: false,
        });
      }),
    ),
  );

it(
  "completes the task when read_task reads the pull request as open while the harness is merging it",
  completesWhenTheTaskIsReadWhileTheHarnessMerges,
);

const REFUSED = { code: 1, stderr: "gh: Base branch was modified. (HTTP 405)", stdout: "" };

const stopsWhenTheSameHeadIsMergedOutsideRightAfterTheHarnessMergeFails = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, head, number, taskId } = yield* reviewed(remote);
        let commit = "";
        github.mergeRefusal = REFUSED;
        github.beforeMerge = Effect.gen(function* () {
          github.beforeMerge = undefined;
          commit = yield* github.mergeOutside(number, "someone-else");
        });
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) !== "running");
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        expect(github.merged).toEqual([]);
        expect(github.pulls[0]).toMatchObject({ head, state: "MERGED" });
        const stopped = reports.at(-1)?.text ?? "";
        expect(stopped).toContain("someone-else");
        expect(stopped).toContain(commit.slice(0, 12));
        expect(stopped).toContain(`at ${github.pulls[0]!.mergedBy!.at}`);
        expect(stopped).toContain("judged from its own record");
        expect(stopped).toContain("GitHub refused the one it sent");
      }),
    ),
  );

it(
  "stops the task, naming who merged it, when the harness's merge is refused and the same head is merged outside the harness",
  stopsWhenTheSameHeadIsMergedOutsideRightAfterTheHarnessMergeFails,
);

const staysStoppedWhenTheSameHeadIsMergedOutsideWhileTheRunEnds = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, number, taskId } = yield* reviewed(remote);
        const merging = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<void>();
        github.mergeRefusal = REFUSED;
        github.beforeMerge = Effect.gen(function* () {
          github.beforeMerge = undefined;
          yield* Deferred.succeed(merging, undefined);
          yield* Deferred.await(gate);
          yield* github.mergeOutside(number, "someone-else");
        });
        workers[1]!.complete("acceptable");
        yield* Deferred.await(merging);
        yield* Effect.promise(() => orchestrator.stop(taskId));
        const before = reports.length;
        const answered = github.answered;
        yield* Deferred.succeed(gate, undefined);
        yield* waitFor(() => github.answered >= answered + 3);
        yield* waitFor(() => reports.length > before);
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        expect(reports.at(-1)?.text).toContain("someone-else");
        expect(github.merged).toEqual([]);
        expect(reports.slice(before).map((report) => report.details.status)).not.toContain(
          "completed",
        );
      }),
    ),
  );

it(
  "keeps the task stopped when its run ends while the harness's merge is refused and the same head is merged outside the harness",
  staysStoppedWhenTheSameHeadIsMergedOutsideWhileTheRunEnds,
);
