import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import pullRequestSupport from "./pull-request-support.ts";

const { taskStatus, waitFor } = orchestratorHarness.harness;
const { exists, reviewed, withRemote } = pullRequestSupport;

const REFUSED = { code: 1, stderr: "gh: Base branch was modified. (HTTP 405)", stdout: "" };
const RUN_POLL_MS = 2_000;
const RERUN_WAIT_MS = 1_000;

function rerunWorktreeExists(workers: readonly { cwd: string; prompts: string[] }[], cwd: string) {
  const rerun = workers.findLast((worker) => worker.prompts[0]?.startsWith("<current-state>"));
  expect(workers.indexOf(rerun!)).toBeGreaterThan(0);
  return exists(`test -d ${rerun!.cwd}`, cwd);
}

const mergeToolThenRerun = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github, repository } = remote;
        const { orchestrator, workers, head, number, taskId } = yield* reviewed(remote);
        github.mergeRefusal = REFUSED;
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "stopped");
        github.mergeRefusal = undefined;
        const [line] = yield* Effect.promise(() =>
          Promise.all([orchestrator.mergePullRequest(number, head), orchestrator.rerun(taskId)]),
        );
        expect(line).toContain(`Task ${taskId} is completed.`);
        expect(github.merged).toMatchObject([{ number, sha: head }]);
        expect(taskStatus(orchestrator, taskId)).toBe("running");
        expect(yield* rerunWorktreeExists(workers, repository)).toBe(true);
      }),
    ),
  );

it(
  "merge_pull_request and rerun_task issued together run one after the other, so the rerun gets a worktree the merge does not remove",
  mergeToolThenRerun,
);

const harnessMergeThenStopAndRerun = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github, repository } = remote;
        const run = yield* reviewed(remote, { runPollMs: RUN_POLL_MS });
        const { orchestrator, workers, head, number, taskId } = run;
        let rerun: Promise<unknown> | undefined;
        github.beforeMerge = Effect.gen(function* () {
          github.beforeMerge = undefined;
          void orchestrator.stop(taskId);
          const started = orchestrator.rerun(taskId);
          rerun = started;
          yield* Effect.race(
            Effect.promise(() => started),
            Effect.sleep(RERUN_WAIT_MS),
          );
        });
        workers[1]!.complete("acceptable");
        yield* waitFor(() => rerun !== undefined);
        yield* Effect.promise(() => rerun!);
        expect(github.merged).toMatchObject([{ number, sha: head }]);
        yield* Effect.sleep(300);
        yield* Effect.promise(() => orchestrator.refresh());
        expect(taskStatus(orchestrator, taskId)).toBe("running");
        expect(yield* rerunWorktreeExists(workers, repository)).toBe(true);
      }),
    ),
  );

it(
  "a stop and rerun_task issued while the harness merges after a passed review wait for the merge, so the rerun's worktree survives it",
  harnessMergeThenStopAndRerun,
);
