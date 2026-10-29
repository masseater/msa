import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { GIT, gatedTarget, read, runCommand, sh, shortId } = worktreeSupport;
const { withRemote } = pullRequestSupport;

const TAG_TASK = {
  currentState: "v1 is not tagged",
  goalState: "tag v1 is on origin",
  opensPullRequest: false,
  title: "tag v1",
};

const completesWithoutAPullRequest = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const task = yield* create(orchestrator, TAG_TASK);
        expect(task.opensPullRequest).toBe(false);

        workers[0]!.complete("tagged v1");
        yield* waitFor(() => workers.length === 2);
        expect(workers[0]!.prompts).toHaveLength(1);

        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
        expect(github.merged).toEqual([]);
        expect((yield* read(orchestrator, task.id)).pullRequest).toBeNull();
      }),
    ),
  );

it(
  "completes a task created with opensPullRequest false on its review, without asking for a pull request",
  completesWithoutAPullRequest,
);

const refusesToCompleteWithCommits = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, reports, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const task = yield* create(orchestrator, TAG_TASK);
        const branch = `task/${shortId(task.id)}`;
        const worker = workers[0]!;

        yield* sh(`echo a > a.txt && git add a.txt && ${GIT} commit -q -m a`, worker.cwd);
        worker.complete("committed a");
        yield* waitFor(() => worker.prompts.length === 2);
        expect(workers).toHaveLength(1);

        yield* sh(`git push -q origin ${branch}`, worker.cwd);
        worker.complete("pushed a");
        yield* waitFor(() => worker.prompts.length === 3);
        expect(workers).toHaveLength(1);

        yield* sh(`git reset -q --hard origin/main && echo n > notes.txt`, worker.cwd);
        worker.complete("dropped the commit");
        yield* waitFor(() => worker.prompts.length === 4);
        expect(workers).toHaveLength(1);

        yield* sh(`rm notes.txt && git push -q origin --delete ${branch}`, worker.cwd);
        worker.complete("removed the branch from origin");
        yield* waitFor(() => workers.length === 2);

        yield* sh(`echo b > b.txt && git add b.txt && ${GIT} commit -q -m b`, worker.cwd);
        workers[1]!.complete("acceptable");
        yield* waitFor(() => workers.length === 3);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        expect(reports.at(-1)?.details.status).toBe("sent-back");
        expect(github.merged).toEqual([]);
      }),
    ),
  );

it(
  "sends a task created with opensPullRequest false back instead of completing it while its branch has a commit, is pushed, or its worktree has uncommitted changes, also after the review passed",
  refusesToCompleteWithCommits,
);

const stillAsksForAPullRequestByDefault = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const task = yield* create(orchestrator, {
          currentState: "v1 is not tagged",
          goalState: "tag v1 is on origin",
          title: "tag v1",
        });
        expect(task.opensPullRequest).toBe(true);

        workers[0]!.complete("tagged v1");
        yield* waitFor(() => workers[0]!.prompts.length === 2);
        expect(workers).toHaveLength(1);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        expect((yield* read(orchestrator, task.id)).pullRequest).toBeNull();
      }),
    ),
  );

it(
  "still sends a task that does not set opensPullRequest back to the worker until it opens a pull request",
  stillAsksForAPullRequestByDefault,
);

const replanCreatesATaskWithoutAPullRequest = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const result = yield* Effect.promise(() =>
          orchestrator.replan({ reason: "release", tasks: [TAG_TASK] }),
        );
        const id = result.created[0]!.taskId;
        expect((yield* read(orchestrator, id)).opensPullRequest).toBe(false);

        workers[0]!.complete("tagged v1");
        yield* waitFor(() => workers.length === 2);
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, id) === "completed");
        expect(github.merged).toEqual([]);
      }),
    ),
  );

it(
  "gives a task replan creates with opensPullRequest false no pull request either",
  replanCreatesATaskWithoutAPullRequest,
);

const refusesMergingAndNoPullRequestTogether = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
      const { gate, target } = yield* gatedTarget(orchestrator);
      const release = yield* create(orchestrator, { ...TAG_TASK, dependsOn: [gate.id] });
      const both = Effect.promise(() =>
        orchestrator.createTask({ ...TAG_TASK, mergeInto: target.id, title: "both" }).then(
          () => "created",
          () => "refused",
        ),
      );
      expect(yield* both).toBe("refused");
      const intoRelease = Effect.promise(() =>
        orchestrator
          .createTask({
            currentState: "a",
            goalState: "b",
            mergeInto: release.id,
            title: "into release",
          })
          .then(
            () => "created",
            () => "refused",
          ),
      );
      expect(yield* intoRelease).toBe("refused");
    }),
  );

it(
  "refuses a task with both opensPullRequest false and mergeInto, and a mergeInto that names a task without a pull request",
  refusesMergingAndNoPullRequestTogether,
);
