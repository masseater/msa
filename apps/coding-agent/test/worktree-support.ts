import testing from "@msa/testing";
import { Effect } from "effect";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";

const { joinPath, makeTempDir, removePath } = testing;
const { runCommand } = orchestratorCallbacks;

const GIT = "git -c user.name=t -c user.email=t@example.invalid";

function sh(command: string, cwd: string): Effect.Effect<string> {
  return Effect.flatMap(
    Effect.promise((signal) => runCommand(command, cwd, 30_000, signal)),
    (result) =>
      result.exitCode === 0
        ? Effect.succeed(result.output.trim())
        : Effect.die(new Error(`${command} in ${cwd}: ${result.output}`)),
  );
}

function commitOnBranch(repository: string, branch: string, message: string) {
  return sh(
    `git branch ${branch} && ${GIT} commit-tree -m ${message} -p ${branch} ${branch}^{tree} | xargs git update-ref refs/heads/${branch}`,
    repository,
  );
}

function withRepository<A, E>(body: (repository: string) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(
    makeTempDir("msa-worktree-"),
    (parent) =>
      Effect.gen(function* () {
        const repository = joinPath(parent, "repo");
        yield* sh(
          `mkdir -p repo/app && echo app > repo/app/README && git -C repo init -q -b main`,
          parent,
        );
        yield* sh(`git add . && ${GIT} commit -q -m init`, repository);
        return yield* body(repository);
      }),
    (parent) => removePath(parent),
  );
}

function shortId(taskId: string): string {
  return taskId.replace(/^t-/u, "");
}

function read(orchestrator: orchestratorTypes.Orchestrator, id: string) {
  return Effect.promise(() => orchestrator.read(id));
}

function gatedTarget(orchestrator: orchestratorTypes.Orchestrator) {
  return Effect.gen(function* () {
    const gate = yield* Effect.promise(() =>
      orchestrator.createTask({ currentState: "a", goalState: "b", title: "gate" }),
    );
    const target = yield* Effect.promise(() =>
      orchestrator.createTask({
        currentState: "the parts are on their own branches",
        dependsOn: [gate.id],
        goalState: "one pull request carries every part",
        title: "integrate",
      }),
    );
    return { gate, target };
  });
}

const worktreeSupport = {
  GIT,
  commitOnBranch,
  gatedTarget,
  read,
  runCommand,
  sh,
  shortId,
  withRepository,
};

export default worktreeSupport;
