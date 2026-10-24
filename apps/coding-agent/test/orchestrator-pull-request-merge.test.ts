import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import threadRun from "../src/core/orchestrator/thread-run.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import type orchestratorHarnessTypes from "./orchestrator-harness.types.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { dirnameOf } = testing;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { runCommand, shortId } = worktreeSupport;
const { advanceMain, commitAndPush, rebaseAndPush, withRemote } = pullRequestSupport;
const { MAX_REJECTIONS } = threadRun.threadRuns;

type Remote = Parameters<Parameters<typeof withRemote>[0]>[0];

function openedTask(remote: Remote, options: orchestratorHarnessTypes.HarnessOptions = {}) {
  return Effect.gen(function* () {
    const { github, repository } = remote;
    const run = setup({ cwd: repository, runCommand, runGh: github.runGh, ...options });
    const task = yield* create(run.orchestrator, {
      currentState: "feature.txt is missing",
      goalState: "feature.txt exists on main",
      title: "feature",
    });
    const branch = `task/${shortId(task.id)}`;
    yield* commitAndPush(run.workers[0]!.cwd, "feature.txt", branch);
    const number = yield* github.open(branch);
    return { ...run, branch, number, taskId: task.id };
  });
}

const waitsForPendingCiBeforeMerging = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, workers, branch, number, taskId } = yield* openedTask(remote);
        const head = yield* github.head(branch);
        github.ci.set(head, "success");
        workers[0]!.complete("CI is green");
        yield* waitFor(() => workers.length === 2);

        github.ci.set(head, "pending");
        const polled = github.calls + 3;
        workers[1]!.complete("acceptable");
        yield* waitFor(() => github.calls >= polled);
        expect(workers).toHaveLength(2);
        expect(github.merged).toEqual([]);
        expect(taskStatus(orchestrator, taskId)).toBe("running");

        github.ci.set(head, "success");
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
        expect(github.merged).toMatchObject([{ number, sha: head }]);
      }),
    ),
  );

it(
  "waits for CI that is pending when the review passes and merges once it is green, without waking the worker",
  waitsForPendingCiBeforeMerging,
);

const waitsForChecksToRegister = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, workers, branch, number, taskId } = yield* openedTask(remote, {
          ciAppearMs: 60_000,
        });
        const head = yield* github.head(branch);
        const polled = github.calls + 3;
        workers[0]!.complete("pushed; CI has not shown up yet");
        yield* waitFor(() => github.calls >= polled);
        expect(workers).toHaveLength(1);
        expect(workers[0]!.prompts).toHaveLength(1);

        github.ci.set(head, "success");
        yield* waitFor(() => workers.length === 2);
        github.ci.delete(head);
        const merging = github.calls + 3;
        workers[1]!.complete("acceptable");
        yield* waitFor(() => github.calls >= merging);
        expect(workers).toHaveLength(2);
        expect(github.merged).toEqual([]);

        github.ci.set(head, "success");
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
        expect(github.merged).toMatchObject([{ number, sha: head }]);
      }),
    ),
  );

it(
  "does not pass a pull request whose checks have not registered yet, at the goal check or at the merge",
  waitsForChecksToRegister,
);

const stopsAfterTheMergeKeepsFallingBehind = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github, origin, repository } = remote;
        const { orchestrator, reports, workers, branch, number, taskId } =
          yield* openedTask(remote);
        github.ci.set(yield* github.head(branch), "success");
        for (let round = 0; round <= MAX_REJECTIONS; round++) {
          const worker = workers.at(-1)!;
          if (round > 0) {
            yield* rebaseAndPush(worker.cwd, branch);
            github.ci.set(yield* github.head(branch), "success");
          }
          const reviewing = workers.length + 1;
          worker.complete(`current with main (${round})`);
          yield* waitFor(() => workers.length === reviewing);
          yield* advanceMain(origin, dirnameOf(repository), `main-${round}.txt`);
          workers.at(-1)!.complete("acceptable");
          if (round < MAX_REJECTIONS) yield* waitFor(() => workers.length === reviewing + 1);
        }
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "stopped");
        expect(github.merged).toEqual([]);
        expect(workers).toHaveLength(2 * (MAX_REJECTIONS + 1));
        expect(reports.at(-1)?.details.status).toBe("stopped");
        expect(reports.at(-1)?.text).toContain(`open pull request #${number}`);
        expect(reports.at(-1)?.text).toContain(branch);
      }),
    ),
  );

it(
  "stops the task, instead of sending it back again, once the pull request has fallen behind at the merge after every allowed round",
  stopsAfterTheMergeKeepsFallingBehind,
);
