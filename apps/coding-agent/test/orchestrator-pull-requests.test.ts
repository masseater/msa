import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import type FakeGitHub from "./fake-github.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { GIT, read, runCommand, sh, shortId } = worktreeSupport;
const { advanceMain, commitAndPush, exists, rebaseAndPush, withRemote } = pullRequestSupport;

type Workers = ReturnType<typeof setup>["workers"];

function started(orchestrator: orchestratorTypes.Orchestrator, title: string) {
  return Effect.gen(function* () {
    const task = yield* create(orchestrator, {
      currentState: `${title}.txt is missing`,
      goalState: `${title}.txt exists on main`,
      title,
    });
    return { branch: `task/${shortId(task.id)}`, task };
  });
}

interface Merging {
  orchestrator: orchestratorTypes.Orchestrator;
  workers: Workers;
  github: FakeGitHub;
  taskId: string;
  branch: string;
}

function holdsTheWorkerUntilCiIsGreen(run: Merging) {
  const { orchestrator, workers, github, taskId, branch } = run;
  return Effect.gen(function* () {
    const worker = workers[0]!;
    yield* commitAndPush(worker.cwd, "feature.txt", branch);
    worker.complete("pushed, no pull request yet");
    yield* waitFor(() => worker.prompts.length === 2);
    expect(workers).toHaveLength(1);
    expect((yield* read(orchestrator, taskId)).pullRequest).toBeNull();

    const number = yield* github.open(branch);
    const head = yield* github.head(branch);
    github.ci.set(head, "pending");
    const polled = github.calls + 3;
    worker.complete("opened the pull request");
    yield* waitFor(() => github.calls >= polled);
    expect(worker.prompts).toHaveLength(2);
    expect(workers).toHaveLength(1);
    expect((yield* read(orchestrator, taskId)).pullRequest).toMatchObject({
      branch,
      ci: "pending",
      headSha: head,
      number,
      state: "OPEN",
      verified: null,
    });
    return { head, number };
  });
}

function mergesAfterTheReview(run: Merging, opened: { head: string; number: number }) {
  const { orchestrator, workers, github, taskId } = run;
  return Effect.gen(function* () {
    github.ci.set(opened.head, "success");
    yield* waitFor(() => workers.length === 2);
    expect(workers[0]!.prompts).toHaveLength(2);
    expect((yield* read(orchestrator, taskId)).pullRequest).toMatchObject({
      ci: "passing",
      mergeState: "CLEAN",
      mergeable: "MERGEABLE",
      verified: { sha: opened.head },
    });
    expect(github.merged).toEqual([]);
    expect(taskStatus(orchestrator, taskId)).toBe("running");

    workers[1]!.complete("acceptable");
    yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
    expect(github.merged).toEqual([
      {
        body: expect.stringMatching(/^Msa-Merge: [0-9a-f-]{36}$/u),
        number: opened.number,
        sha: opened.head,
        subject: `Add ${run.branch} (#${opened.number})`,
      },
    ]);
    expect((yield* read(orchestrator, taskId)).pullRequest?.state).toBe("MERGED");
  });
}

const mergesTheReviewedHeadOnceCiIsGreen = () =>
  Effect.runPromise(
    withRemote(({ github, origin, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const { task, branch } = yield* started(orchestrator, "feature");
        const worktree = workers[0]!.cwd;
        const run = { branch, github, orchestrator, taskId: task.id, workers };

        yield* mergesAfterTheReview(run, yield* holdsTheWorkerUntilCiIsGreen(run));

        expect(yield* sh(`git -C ${origin} show main:feature.txt`, repository)).toBe("feature.txt");
        expect(yield* exists(`test -d ${worktree}`, repository)).toBe(false);
        expect(
          yield* exists(`git rev-parse --verify --quiet refs/heads/${branch}`, repository),
        ).toBe(false);
        expect(
          yield* exists(`git ls-remote --exit-code --heads origin ${branch}`, repository),
        ).toBe(false);
      }),
    ),
  );

it(
  "waits for CI on the task's own pull request without waking the worker, then squash-merges the reviewed head with the reviewed title and body and removes the worktree and both branches",
  mergesTheReviewedHeadOnceCiIsGreen,
);

function sendsBackUntilClean(run: Merging, number: number) {
  const { orchestrator, workers, github, taskId, branch } = run;
  return Effect.gen(function* () {
    const worker = workers[0]!;
    github.ci.set(yield* github.head(branch), "failure");
    worker.complete("CI is red");
    yield* waitFor(() => worker.prompts.length === 2);
    expect(workers).toHaveLength(1);
    expect((yield* read(orchestrator, taskId)).pullRequest?.ci).toBe("failing");

    github.ci.set(yield* github.head(branch), "success");
    yield* sh(`echo b > b.txt && git add b.txt && ${GIT} commit -q -m b`, worker.cwd);
    worker.complete("committed b without pushing");
    yield* waitFor(() => worker.prompts.length === 3);
    expect(workers).toHaveLength(1);

    yield* sh(`git push -q origin ${branch}`, worker.cwd);
    github.ci.set(yield* github.head(branch), "success");
    github.conflicting.add(number);
    worker.complete("pushed");
    yield* waitFor(() => worker.prompts.length === 4);
    expect(workers).toHaveLength(1);
    expect((yield* read(orchestrator, taskId)).pullRequest?.mergeable).toBe("CONFLICTING");
  });
}

const sendsBackAFailingUnpushedOrConflictingPullRequest = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const { task, branch } = yield* started(orchestrator, "a");
        yield* commitAndPush(workers[0]!.cwd, "a.txt", branch);
        const number = yield* github.open(branch);
        const run = { branch, github, orchestrator, taskId: task.id, workers };

        yield* sendsBackUntilClean(run, number);

        github.conflicting.delete(number);
        workers[0]!.complete("resolved the conflict");
        yield* waitFor(() => workers.length === 2);
        expect((yield* read(orchestrator, task.id)).pullRequest?.verified?.sha).toBe(
          yield* github.head(branch),
        );
      }),
    ),
  );

it(
  "sends the worker back while CI fails, its head is unpushed, or the pull request conflicts, and starts the reviewer only after that",
  sendsBackAFailingUnpushedOrConflictingPullRequest,
);

const sendsBackAPullRequestBehindItsBase = () =>
  Effect.runPromise(
    withRemote(({ github, origin, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const { task, branch } = yield* started(orchestrator, "behind");
        const worker = workers[0]!;
        yield* commitAndPush(worker.cwd, "behind.txt", branch);
        yield* github.open(branch);
        github.ci.set(yield* github.head(branch), "success");
        yield* advanceMain(origin, "main-moved.txt");
        worker.complete("green");
        yield* waitFor(() => worker.prompts.length === 2);
        expect(workers).toHaveLength(1);
        expect((yield* read(orchestrator, task.id)).pullRequest?.mergeState).toBe("BEHIND");

        yield* rebaseAndPush(worker.cwd, origin, branch);
        const rebased = yield* github.head(branch);
        github.ci.set(rebased, "success");
        worker.complete("rebased");
        yield* waitFor(() => workers.length === 2);
        expect((yield* read(orchestrator, task.id)).pullRequest?.verified?.sha).toBe(rebased);
      }),
    ),
  );

it(
  "sends the worker back to rebase while its pull request is behind its base",
  sendsBackAPullRequestBehindItsBase,
);

function sendsBackWhenBehindAtMerge(
  run: Merging & { reports: ReturnType<typeof setup>["reports"] },
  origin: string,
) {
  const { orchestrator, workers, github, taskId, reports } = run;
  return Effect.gen(function* () {
    yield* advanceMain(origin, "other.txt");
    workers[1]!.complete("acceptable");
    yield* waitFor(() => workers.length === 3);
    expect(github.merged).toEqual([]);
    expect(taskStatus(orchestrator, taskId)).toBe("running");
    expect(reports.at(-1)?.details.status).toBe("sent-back");
  });
}

function sendsBackWhenTheHeadMovedAfterReview(
  run: Merging & { reports: ReturnType<typeof setup>["reports"] },
) {
  const { workers, github, branch, reports } = run;
  return Effect.gen(function* () {
    yield* rebaseAndPush(workers[2]!.cwd, github.origin, branch);
    github.ci.set(yield* github.head(branch), "success");
    workers[2]!.complete("rebased");
    yield* waitFor(() => workers.length === 4);
    yield* commitAndPush(workers[2]!.cwd, "late.txt", branch);
    github.ci.set(yield* github.head(branch), "success");
    workers[3]!.complete("acceptable");
    yield* waitFor(() => workers.length === 5);
    expect(github.merged).toEqual([]);
    expect(reports.at(-1)?.details.status).toBe("sent-back");
  });
}

const sendsBackWhenThePullRequestCannotMergeAfterReview = () =>
  Effect.runPromise(
    withRemote(({ github, origin, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, reports, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const { task, branch } = yield* started(orchestrator, "c");
        yield* commitAndPush(workers[0]!.cwd, "c.txt", branch);
        const number = yield* github.open(branch);
        github.ci.set(yield* github.head(branch), "success");
        workers[0]!.complete("green");
        yield* waitFor(() => workers.length === 2);
        const run = { branch, github, orchestrator, reports, taskId: task.id, workers };

        yield* sendsBackWhenBehindAtMerge(run, origin);
        yield* sendsBackWhenTheHeadMovedAfterReview(run);

        const late = yield* github.head(branch);
        workers[4]!.complete("the late commit is the work");
        yield* waitFor(() => workers.length === 6);
        workers[5]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
        expect(github.merged).toMatchObject([{ number, sha: late }]);
      }),
    ),
  );

it(
  "sends the task back instead of completing it when its pull request fell behind or its head moved after the review passed",
  sendsBackWhenThePullRequestCannotMergeAfterReview,
);
