import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { dirnameOf } = testing;
const { create } = orchestratorSupport;
const { setup, waitFor } = orchestratorHarness.harness;
const { read, runCommand, sh, shortId } = worktreeSupport;
const { commitAndPush, withRemote } = pullRequestSupport;

const namesAReplacedTaskThatRanOutsideGit = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const outside = dirnameOf(repository);
        const task = yield* create(orchestrator, {
          currentState: "g.txt is missing",
          cwd: outside,
          goalState: "g.txt exists on main",
          title: "g",
        });
        yield* waitFor(() => workers.length === 1);
        expect(workers[0]!.cwd).toBe(outside);
        yield* sh("git switch -q -c by-hand", repository);
        yield* commitAndPush(repository, "g.txt", "by-hand");
        yield* sh("git switch -q main", repository);
        yield* github.open("by-hand");
        yield* Effect.promise(() => orchestrator.stop(task.id));

        const result = yield* Effect.promise(() =>
          orchestrator.replan({
            reason: "the worker opened a pull request from a branch of its own",
            stop: false,
            tasks: [{ cwd: repository, from: [task.id], title: "g again" }],
          }),
        );
        const heir = result.created[0]!.taskId;
        expect(result.handedOver).toEqual([]);
        expect(result.orphaned).toEqual([]);
        expect(result.untracked).toEqual([{ cwd: outside, taskId: task.id }]);
        expect((yield* read(orchestrator, task.id)).pullRequest).toBeNull();
        expect((yield* read(orchestrator, heir)).pullRequest).toBeNull();
        const branch = `task/${shortId(heir)}`;
        yield* waitFor(() => workers.some((worker) => worker.cwd.endsWith(shortId(heir))));
        const worktree = workers.find((worker) => worker.cwd.endsWith(shortId(heir)))!.cwd;
        expect(yield* sh("git rev-parse --abbrev-ref HEAD", worktree)).toBe(branch);
        expect(github.merged).toEqual([]);
      }),
    ),
  );

it(
  "names a replaced task that ran outside a git working tree, hands it no pull request, and starts the new task on its own branch",
  namesAReplacedTaskThatRanOutsideGit,
);
