import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import pullRequestSupport from "./pull-request-support.ts";
import triageSupport from "./triage-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { escalateTriage } = triageSupport;
const { harness } = orchestratorHarness;
const { taskStatus, waitFor } = harness;
const { advanceMain, openedTask, rebaseAndPush, withRemote } = pullRequestSupport;
const { GIT_ROUNDS_TIMEOUT_MS } = worktreeSupport;

const MANY_ROUNDS = 5;

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

const keepsSendingBackAPullRequestThatFallsBehind = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github, origin } = remote;
        const { orchestrator, workers, branch, number, taskId } = yield* openedTask(remote);
        github.ci.set(yield* github.head(branch), "success");
        for (let round = 0; round < MANY_ROUNDS; round++) {
          const worker = workers.at(-1)!;
          if (round > 0) {
            yield* rebaseAndPush(worker.cwd, origin, branch);
            github.ci.set(yield* github.head(branch), "success");
          }
          const reviewing = workers.length + 1;
          worker.complete(`current with main (${round})`);
          yield* waitFor(() => workers.length === reviewing);
          yield* advanceMain(origin, `main-${round}.txt`);
          workers.at(-1)!.complete("acceptable");
          yield* waitFor(() => workers.length === reviewing + 1);
          expect(taskStatus(orchestrator, taskId)).toBe("running");
        }
        expect(github.merged).toEqual([]);

        const worker = workers.at(-1)!;
        yield* rebaseAndPush(worker.cwd, origin, branch);
        const head = yield* github.head(branch);
        github.ci.set(head, "success");
        worker.complete("current with main at last");
        yield* waitFor(() => workers.length === 2 * MANY_ROUNDS + 2);
        workers.at(-1)!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
        expect(github.merged).toMatchObject([{ number, sha: head }]);
      }),
    ),
  );

it(
  "sends a pull request that falls behind at the merge back for as many rounds as it takes, and merges it once it is current",
  keepsSendingBackAPullRequestThatFallsBehind,
  GIT_ROUNDS_TIMEOUT_MS,
);

const asksForADecisionWhenTheMergeIsBlockedAtTheSameHead = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, branch, taskId } = yield* openedTask(remote);
        const head = yield* github.head(branch);
        for (let round = 0; round < 2; round++) {
          github.ci.set(head, "success");
          workers.at(-1)!.complete(`CI is green (${round})`);
          yield* waitFor(() => workers.length === 2 * round + 2);
          github.ci.set(head, "failure");
          workers.at(-1)!.complete("acceptable");
          if (round === 0) yield* waitFor(() => workers.length === 3);
        }
        yield* escalateTriage(workers);
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "needs-decision");
        expect(github.merged).toEqual([]);
        expect(workers).toHaveLength(5);
        expect(reports.at(-1)?.details.status).toBe("needs-decision");
        expect(reports.at(-1)?.text).toContain("the work is not moving");
      }),
    ),
  );

it(
  "waits for a decision instead of sending the work back again when the merge is blocked again at the head it was already sent back with",
  asksForADecisionWhenTheMergeIsBlockedAtTheSameHead,
);
