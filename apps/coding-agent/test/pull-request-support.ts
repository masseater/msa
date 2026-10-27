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
const { setup, waitFor } = orchestratorHarness.harness;

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
        yield* importCommit(origin, "README", null);
        yield* sh(
          `git clone -q ${origin} repo && echo ${repository}/.git/objects > ${origin}/objects/info/alternates && echo ${origin}/objects > ${repository}/.git/objects/info/alternates`,
          parent,
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

function rebaseAndPush(cwd: string, origin: string, branch: string) {
  return sh(
    [
      `git update-ref refs/remotes/origin/main $(git --git-dir=${origin} rev-parse refs/heads/main)`,
      `${GIT} rebase -q origin/main`,
      `git --git-dir=${origin} update-ref refs/heads/${branch} $(git rev-parse HEAD)`,
    ].join(" && "),
    cwd,
  );
}

function importCommit(origin: string, file: string, parent: string | null) {
  return sh(
    [
      "git fast-import --quiet <<'EOF'",
      "commit refs/heads/main",
      "committer t <t@example.invalid> 1700000000 +0000",
      "data <<MESSAGE",
      file,
      "MESSAGE",
      ...(parent === null ? [] : [`from ${parent}`]),
      `M 100644 inline ${file}`,
      "data <<CONTENT",
      file,
      "CONTENT",
      "EOF",
    ].join("\n"),
    origin,
  );
}

function advanceMain(origin: string, file: string) {
  return importCommit(origin, file, "refs/heads/main^0");
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

function reviewed(remote: Remote, options: orchestratorHarnessTypes.HarnessOptions = {}) {
  return Effect.gen(function* () {
    const run = yield* openedTask(remote, options);
    const head = yield* remote.github.head(run.branch);
    remote.github.ci.set(head, "success");
    const worktree = run.workers[0]!.cwd;
    run.workers[0]!.complete("CI is green");
    yield* waitFor(() => run.workers.length === 2);
    return { ...run, head, worktree };
  });
}

function cleanedUp(remote: Remote, worktree: string, branch: string) {
  return Effect.gen(function* () {
    const { repository } = remote;
    return {
      local: yield* exists(`git rev-parse --verify --quiet refs/heads/${branch}`, repository),
      remote: yield* exists(`git ls-remote --exit-code --heads origin ${branch}`, repository),
      worktree: yield* exists(`test -d ${worktree}`, repository),
    };
  });
}

const pullRequestSupport = {
  advanceMain,
  cleanedUp,
  commitAndPush,
  exists,
  openedTask,
  rebaseAndPush,
  reviewed,
  withRemote,
};

export default pullRequestSupport;
