import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import type FakeGitHub from "./fake-github.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { dirnameOf } = testing;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { read, runCommand, sh, shortId } = worktreeSupport;
const { commitAndPush, withRemote } = pullRequestSupport;

type Workers = ReturnType<typeof setup>["workers"];

function openedAndWaitingForCi(
  orchestrator: orchestratorTypes.Orchestrator,
  workers: Workers,
  github: FakeGitHub,
  title: string,
) {
  return Effect.gen(function* () {
    const task = yield* create(orchestrator, {
      currentState: `${title}.txt is missing`,
      goalState: `${title}.txt exists on main`,
      title,
    });
    const branch = `task/${shortId(task.id)}`;
    yield* commitAndPush(workers[0]!.cwd, `${title}.txt`, branch);
    const number = yield* github.open(branch);
    github.ci.set(yield* github.head(branch), "pending");
    const polled = github.calls + 3;
    workers[0]!.complete("waiting for CI");
    yield* waitFor(() => github.calls >= polled);
    return { branch, number, task };
  });
}

function mergesInTheHeir(workers: Workers, github: FakeGitHub, worktree: string, branch: string) {
  return Effect.gen(function* () {
    yield* waitFor(() => workers.some((worker, index) => index > 0 && worker.cwd === worktree));
    const heir = workers.at(-1)!;
    expect(yield* sh("git rev-parse --abbrev-ref HEAD", heir.cwd)).toBe(branch);
    const head = yield* github.head(branch);
    github.ci.set(head, "success");
    const before = workers.length;
    heir.complete("CI is green");
    yield* waitFor(() => workers.length === before + 1);
    workers.at(-1)!.complete("acceptable");
    return head;
  });
}

const handsThePullRequestToTheTaskThatReplacesIt = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const first = yield* openedAndWaitingForCi(orchestrator, workers, github, "d");
        const worktree = workers[0]!.cwd;
        yield* Effect.promise(() => orchestrator.stop(first.task.id));

        const result = yield* Effect.promise(() =>
          orchestrator.replan({
            reason: "the first try stalled",
            stop: false,
            tasks: [{ from: [first.task.id], title: "d again" }],
          }),
        );
        const second = result.created[0]!.taskId;
        expect(result.handedOver).toEqual([
          { from: first.task.id, number: first.number, to: second },
        ]);
        expect(result.orphaned).toEqual([]);
        expect((yield* read(orchestrator, first.task.id)).pullRequest).toBeNull();
        expect((yield* read(orchestrator, second)).pullRequest?.number).toBe(first.number);

        const head = yield* mergesInTheHeir(workers, github, worktree, first.branch);
        yield* waitFor(() => taskStatus(orchestrator, second) === "completed");
        expect(github.merged).toMatchObject([{ number: first.number, sha: head }]);
      }),
    ),
  );

it(
  "hands an open pull request to the task a replan creates from its task, which continues on the same branch and merges it",
  handsThePullRequestToTheTaskThatReplacesIt,
);

const handsOverAPullRequestTheHarnessHasNotReadYet = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const task = yield* create(orchestrator, {
          currentState: "f.txt is missing",
          goalState: "f.txt exists on main",
          title: "f",
        });
        const branch = `task/${shortId(task.id)}`;
        const worktree = workers[0]!.cwd;
        yield* commitAndPush(worktree, "f.txt", branch);
        const number = yield* github.open(branch);
        const stopped = yield* Effect.promise(() => orchestrator.stop(task.id));
        expect(stopped.pullRequest).toBeNull();

        const result = yield* Effect.promise(() =>
          orchestrator.replan({
            reason: "the worker stopped before its turn ended",
            stop: false,
            tasks: [{ from: [task.id], title: "f again" }],
          }),
        );
        const heir = result.created[0]!.taskId;
        expect(result.handedOver).toEqual([{ from: task.id, number, to: heir }]);
        expect(result.orphaned).toEqual([]);
        expect((yield* read(orchestrator, heir)).pullRequest?.number).toBe(number);

        const head = yield* mergesInTheHeir(workers, github, worktree, branch);
        yield* waitFor(() => taskStatus(orchestrator, heir) === "completed");
        expect(github.merged).toMatchObject([{ number, sha: head }]);
      }),
    ),
  );

it(
  "hands a pull request the worker opened before the harness read it to the task a replan creates from its task, which reviews and merges it",
  handsOverAPullRequestTheHarnessHasNotReadYet,
);

const reportsAnOpenPullRequestNoTaskCarriesOn = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const { branch, number, task } = yield* openedAndWaitingForCi(
          orchestrator,
          workers,
          github,
          "e",
        );

        const stopped = yield* Effect.promise(() => orchestrator.stop(task.id));
        expect(stopped.pullRequest).toMatchObject({ number, state: "OPEN", taskId: task.id });

        const result = yield* Effect.promise(() =>
          orchestrator.replan({
            drop: [{ reason: "not needed", taskId: task.id }],
            reason: "scope cut",
            stop: false,
          }),
        );
        expect(result.handedOver).toEqual([]);
        expect(result.orphaned).toEqual([
          { branch, number, taskId: task.id, url: `https://github.invalid/pull/${number}` },
        ]);
        expect((yield* read(orchestrator, task.id)).pullRequest?.number).toBe(number);
      }),
    ),
  );

it(
  "reports an open pull request that no task carries on after a drop and keeps it on the dropped task",
  reportsAnOpenPullRequestNoTaskCarriesOn,
);

function partMergedIntoAWaitingTarget(
  orchestrator: orchestratorTypes.Orchestrator,
  workers: Workers,
  repository: string,
) {
  return Effect.gen(function* () {
    const gate = yield* create(orchestrator, {
      currentState: "a",
      cwd: dirnameOf(repository),
      goalState: "b",
      title: "gate outside the repository",
    });
    const target = yield* create(orchestrator, {
      currentState: "the parts are apart",
      dependsOn: [gate.id],
      goalState: "one pull request carries every part",
      title: "integrate",
    });
    const part = yield* create(orchestrator, {
      currentState: "part.txt is missing",
      goalState: "part.txt is on the target branch",
      mergeInto: target.id,
      title: "part",
    });
    const partBranch = `task/${shortId(part.id)}`;
    yield* commitAndPush(workers[1]!.cwd, "part.txt", partBranch);
    workers[1]!.complete("pushed the part");
    yield* waitFor(() => workers.length === 3);
    workers[2]!.complete("acceptable");
    yield* waitFor(() => taskStatus(orchestrator, part.id) === "completed");
    workers[0]!.complete("gate done");
    yield* waitFor(() => workers.length === 4);
    workers[3]!.complete("acceptable");
    yield* waitFor(() => workers.length === 5);
    return { part, partBranch, target, targetBranch: `task/${shortId(target.id)}` };
  });
}

const showsTheTargetPullRequestOnAMergedTask = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const { part, partBranch, target, targetBranch } = yield* partMergedIntoAWaitingTarget(
          orchestrator,
          workers,
          repository,
        );
        expect(github.merged).toEqual([]);

        const targetWorker = workers[4]!;
        yield* sh(`git merge -q --no-edit ${partBranch}`, targetWorker.cwd);
        yield* sh(`git push -q origin ${targetBranch}`, targetWorker.cwd);
        const number = yield* github.open(targetBranch);
        const head = yield* github.head(targetBranch);
        github.ci.set(head, "success");
        targetWorker.complete("merged the part and opened the pull request");
        yield* waitFor(() => workers.length === 6);
        expect((yield* read(orchestrator, part.id)).pullRequest?.number).toBe(number);

        workers[5]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, target.id) === "completed");
        expect(github.merged).toMatchObject([{ number, sha: head }]);
        expect(yield* sh(`git branch --list ${partBranch} ${targetBranch}`, repository)).toBe("");
        expect(yield* sh(`git worktree list --porcelain | grep -c '^worktree'`, repository)).toBe(
          "1",
        );
      }),
    ),
  );

it(
  "shows the target's pull request on a task that merges into it, lets that task finish without one, and removes both branches once the target merges",
  showsTheTargetPullRequestOnAMergedTask,
);
