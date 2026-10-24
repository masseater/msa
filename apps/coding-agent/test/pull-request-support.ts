import testing from "@msa/testing";
import { Effect } from "effect";

import FakeGitHub from "./fake-github.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import type orchestratorHarnessTypes from "./orchestrator-harness.types.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath, makeTempDir, removePath } = testing;
const { GIT, runCommand, sh, shortId } = worktreeSupport;
const { create } = orchestratorSupport;
const { setup } = orchestratorHarness.harness;

interface Remote {
  repository: string;
  origin: string;
  github: FakeGitHub;
}

function withRemote<A, E>(body: (remote: Remote) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(
    makeTempDir("msa-pull-request-"),
    (parent) =>
      Effect.gen(function* () {
        const repository = joinPath(parent, "repo");
        const origin = joinPath(parent, "origin.git");
        yield* sh(`git init -q --bare -b main origin.git`, parent);
        yield* sh(`mkdir repo && echo app > repo/README && git -C repo init -q -b main`, parent);
        yield* sh(`git add . && ${GIT} commit -q -m init`, repository);
        yield* sh(
          `git remote add origin ${origin} && git push -q -u origin main && git remote set-head origin main`,
          repository,
        );
        return yield* body({ github: new FakeGitHub(origin), origin, repository });
      }),
    (parent) => removePath(parent),
  );
}

function commitAndPush(cwd: string, file: string, branch: string) {
  return sh(
    `echo ${file} > ${file} && git add ${file} && ${GIT} commit -q -m ${file} && git push -q origin ${branch}`,
    cwd,
  );
}

function exists(command: string, cwd: string) {
  return Effect.map(
    Effect.promise((signal) => runCommand(command, cwd, 30_000, signal)),
    (result) => result.exitCode === 0,
  );
}

function rebaseAndPush(cwd: string, branch: string) {
  return sh(
    `git fetch -q origin main && ${GIT} rebase -q origin/main && git push -q -f origin ${branch}`,
    cwd,
  );
}

function advanceMain(origin: string, parent: string, file: string) {
  return sh(
    `git clone -q ${origin} side-${file} && cd side-${file} && echo ${file} > ${file} && git add ${file} && ${GIT} commit -q -m ${file} && git push -q origin main && cd .. && rm -rf side-${file}`,
    parent,
  );
}

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

const pullRequestSupport = {
  advanceMain,
  commitAndPush,
  exists,
  openedTask,
  rebaseAndPush,
  withRemote,
};

export default pullRequestSupport;
