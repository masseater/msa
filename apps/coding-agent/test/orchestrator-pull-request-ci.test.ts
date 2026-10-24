import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import threadRun from "../src/core/orchestrator/thread-run.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import type orchestratorHarnessTypes from "./orchestrator-harness.types.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { runCommand, shortId } = worktreeSupport;
const { commitAndPush, withRemote } = pullRequestSupport;
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

const waitsOnPendingCiWithoutCountingIt = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, workers, branch, taskId } = yield* openedTask(remote);
        const worker = workers[0]!;
        github.ci.set(yield* github.head(branch), "pending");

        for (let turn = 1; turn <= MAX_REJECTIONS + 2; turn++) {
          const polled = github.calls + 2;
          worker.complete(`CI is still running (${turn})`);
          yield* waitFor(() => github.calls >= polled);
          expect(worker.prompts).toHaveLength(turn);
          yield* Effect.promise(() => orchestrator.sendMessage(taskId, `still there? (${turn})`));
          yield* waitFor(() => worker.prompts.length === turn + 1);
        }
        expect(taskStatus(orchestrator, taskId)).toBe("running");
        expect(workers).toHaveLength(1);

        worker.complete("waiting for CI");
        github.ci.set(yield* github.head(branch), "success");
        yield* waitFor(() => workers.length === 2);
        expect(taskStatus(orchestrator, taskId)).toBe("running");
      }),
    ),
  );

it(
  "keeps waiting for CI however many turns the worker ends while it is pending, and starts the review once it is green",
  waitsOnPendingCiWithoutCountingIt,
);

const countsFailingCi = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, workers, branch, taskId } = yield* openedTask(remote);
        const worker = workers[0]!;
        for (let round = 1; round <= MAX_REJECTIONS; round++) {
          github.ci.set(yield* github.head(branch), "failure");
          worker.complete(`pushed (${round})`);
          yield* waitFor(() => worker.prompts.length === round + 1);
          yield* commitAndPush(worker.cwd, `fix-${round}.txt`, branch);
        }
        github.ci.set(yield* github.head(branch), "failure");
        worker.complete("pushed once more");
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "failed");
        expect(workers).toHaveLength(1);
      }),
    ),
  );

it(
  "counts each failing CI run against the worker and fails the task once the rounds of fixes run out",
  countsFailingCi,
);

const passesAPullRequestWithoutChecks = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, workers, number, taskId } = yield* openedTask(remote);
        workers[0]!.complete("opened, and this repository has no CI");
        yield* waitFor(() => workers.length === 2);
        expect((yield* Effect.promise(() => orchestrator.read(taskId))).pullRequest?.ci).toBe(
          "none",
        );
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
        expect(github.merged).toMatchObject([{ number }]);
      }),
    ),
  );

it(
  "treats a pull request with no checks as a repository without CI and merges it after the review",
  passesAPullRequestWithoutChecks,
);

const UNAVAILABLE = [
  { code: 127, stderr: "gh is not on PATH", stdout: "" },
  {
    code: 4,
    stderr: "To get started with GitHub CLI, please run:  gh auth login",
    stdout: "",
  },
  {
    code: 1,
    stderr: "none of the git remotes configured for this repository point to a known GitHub host",
    stdout: "",
  },
];

const stopsWhenGhCannotReadPullRequests = () =>
  Effect.runPromise(
    Effect.forEach(UNAVAILABLE, (failure) =>
      withRemote((remote) =>
        Effect.gen(function* () {
          const { github } = remote;
          const { orchestrator, reports, workers, taskId } = yield* openedTask(remote);
          github.unavailable = failure;
          workers[0]!.complete("done");
          yield* waitFor(() => taskStatus(orchestrator, taskId) === "stopped");
          expect(workers[0]!.prompts).toHaveLength(1);
          expect(reports.at(-1)?.details.status).toBe("stopped");
          expect(reports.at(-1)?.text).toContain(failure.stderr);
        }),
      ),
    ),
  );

it(
  "stops the task with gh's reason when gh is missing, logged out, or origin is not on GitHub, instead of sending the worker back",
  stopsWhenGhCannotReadPullRequests,
);

const stopsWhenCiNeverFinishes = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, branch, taskId } = yield* openedTask(remote, {
          ciWaitMs: 50,
        });
        github.ci.set(yield* github.head(branch), "pending");
        workers[0]!.complete("waiting for CI");
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "stopped");
        expect(workers[0]!.prompts).toHaveLength(1);
        expect(reports.at(-1)?.details.status).toBe("stopped");
      }),
    ),
  );

it("stops the task when CI stays pending past the wait limit", stopsWhenCiNeverFinishes);

const sendsBackWhenTheBodyChangedAfterReview = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, reports, workers, number, taskId } = yield* openedTask(remote);
        workers[0]!.complete("opened");
        yield* waitFor(() => workers.length === 2);
        github.pulls[0]!.body = "Rewritten after the review.";
        workers[1]!.complete("acceptable");
        yield* waitFor(() => workers.length === 3);
        expect(github.merged).toEqual([]);
        expect(reports.at(-1)?.details.status).toBe("sent-back");

        workers[2]!.complete("the body now matches the diff");
        yield* waitFor(() => workers.length === 4);
        workers[3]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
        expect(github.merged).toMatchObject([{ body: "Rewritten after the review.", number }]);
      }),
    ),
  );

it(
  "does not merge a pull request whose body changed after the review, and merges it with the body the next review read",
  sendsBackWhenTheBodyChangedAfterReview,
);
