import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath, makeTempDir, removePath } = testing;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { commitOnBranch, gatedTarget, read, runCommand, sh, shortId, withRepository } =
  worktreeSupport;

const startsTheWorkerInAWorktreeAndChecksThere = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: joinPath(repository, "app"),
          runCommand,
        });
        const task = yield* create(orchestrator, {
          checks: [{ command: "cat done.txt", output: "^done$" }],
          currentState: "done.txt is missing",
          goalState: "done.txt says done",
          title: "write done",
        });
        const branch = `task/${shortId(task.id)}`;
        const worker = workers[0]!;

        expect(yield* sh("git rev-parse --abbrev-ref HEAD", worker.cwd)).toBe(branch);
        expect(yield* sh("git rev-parse --show-prefix", worker.cwd)).toBe("app/");
        expect(yield* sh("basename $(git rev-parse --show-toplevel)", worker.cwd)).toBe(
          `repo-${shortId(task.id)}`,
        );
        expect(yield* sh("git rev-parse --abbrev-ref HEAD", repository)).toBe("main");
        expect(orchestrator.snapshot.threads[0]).toMatchObject({
          branch,
          cwd: worker.cwd,
          targetBranch: "main",
        });
        expect(worker.prompts[0]).toContain(
          `on branch ${branch}. Work and commit here; do not create another worktree`,
        );
        expect(worker.prompts[0]).toContain(`push ${branch} and open a pull request into main.`);

        yield* sh("echo done > done.txt", worker.cwd);
        worker.complete("wrote done.txt");
        yield* waitFor(() => workers.length === 2);
        expect(worker.prompts).toHaveLength(1);
        const reviewer = workers[1]!;
        expect(reviewer.cwd).toBe(worker.cwd);
        expect(reviewer.prompts[0]).toContain(`the diff of ${branch} against main.`);

        reviewer.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
        expect(yield* sh("git rev-parse --abbrev-ref HEAD", worker.cwd)).toBe(branch);
        expect(yield* sh("cat done.txt", worker.cwd)).toBe("done");
      }),
    ),
  );

it(
  "starts the worker in a worktree and branch it creates, runs the goal's checks there, and keeps the worktree after the task ends",
  startsTheWorkerInAWorktreeAndChecksThere,
);

const branchesFromTheMergeTarget = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({ cwd: repository, runCommand });
        const { gate, target } = yield* gatedTarget(orchestrator);
        const targetBranch = `task/${shortId(target.id)}`;
        yield* commitOnBranch(repository, targetBranch, "target");
        const part = yield* create(orchestrator, {
          currentState: "c",
          goalState: "d",
          mergeInto: target.id,
          title: "part",
        });
        const partBranch = `task/${shortId(part.id)}`;
        const partWorker = workers[1]!;

        expect(yield* sh("git log -1 --format=%s", partWorker.cwd)).toBe("target");
        expect(partWorker.prompts[0]).toContain(
          `This work merges into task ${target.id} "integrate" on branch ${targetBranch}, which opens the pull request. Commit and push ${partBranch}; do not open a pull request.`,
        );

        expect((yield* read(orchestrator, target.id)).dependsOn).toEqual(
          [gate.id, part.id].toSorted(),
        );
        workers[0]!.complete("gate done");
        yield* waitFor(() => workers.length === 3);
        workers[2]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, gate.id) === "completed");
        expect(taskStatus(orchestrator, target.id)).toBe("waiting");
        expect(workers).toHaveLength(3);

        partWorker.complete("part pushed");
        yield* waitFor(() => workers.length === 4);
        workers[3]!.complete("acceptable");
        yield* waitFor(() => workers.length === 5);
        const targetWorker = workers[4]!;
        expect(yield* sh("git rev-parse --abbrev-ref HEAD", targetWorker.cwd)).toBe(targetBranch);
        expect(yield* sh("git log -1 --format=%s", targetWorker.cwd)).toBe("target");
        expect(targetWorker.prompts[0]).toContain(
          `Merge their branches into ${targetBranch} before you open the pull request:\n- ${partBranch} (task ${part.id} "part")`,
        );
        expect(targetWorker.prompts[0]).toContain(
          `push ${targetBranch} and open a pull request into main.`,
        );
      }),
    ),
  );

it(
  "branches a task that merges into another from that task's branch, makes the target wait for it, and lists it to the target",
  branchesFromTheMergeTarget,
);

const leavesAPlainDirectoryAsItIs = () =>
  Effect.runPromise(
    Effect.acquireUseRelease(
      makeTempDir("msa-no-repo-"),
      (directory) =>
        Effect.gen(function* () {
          const { orchestrator, workers } = setup({ cwd: directory, runCommand });
          yield* create(orchestrator, { currentState: "a", goalState: "b", title: "plain" });
          expect(workers[0]?.cwd).toBe(directory);
          expect(workers[0]?.prompts[0]).not.toContain("<workspace>");
          expect(orchestrator.snapshot.threads[0]).toMatchObject({
            branch: null,
            targetBranch: null,
          });
        }),
      (directory) => removePath(directory),
    ),
  );

it(
  "starts the worker in the task's directory when it is not a git repository",
  leavesAPlainDirectoryAsItIs,
);

const rejectsAReviewTaskAsMergeTarget = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
      const work = yield* create(orchestrator, { currentState: "a", goalState: "b", title: "w" });
      const review = orchestrator.snapshot.tasks.find((task) => task.kind === "review")!;
      const rejected = yield* Effect.promise(() =>
        orchestrator
          .createTask({ currentState: "c", goalState: "d", mergeInto: review.id, title: "x" })
          .then(
            () => undefined,
            (error: unknown) => error,
          ),
      );
      expect(String(rejected)).toContain("is a review task");
      const unknown = yield* Effect.promise(() =>
        orchestrator
          .createTask({ currentState: "c", goalState: "d", mergeInto: "t-missing", title: "x" })
          .then(
            () => undefined,
            (error: unknown) => error,
          ),
      );
      expect(String(unknown)).toContain("Unknown merge target: t-missing");
      expect(work.mergeInto).toBeNull();
    }),
  );

it("rejects a merge target that is not a work task", rejectsAReviewTaskAsMergeTarget);
