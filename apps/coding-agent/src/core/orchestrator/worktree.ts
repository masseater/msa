import { Effect } from "effect";

import exec from "../exec.ts";
import platformPath from "../platform/path.ts";
import errors from "./errors.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { orchestratorError } = errors;
const { execCommand } = exec;
const { store } = storeModule;

const GIT_TIMEOUT_MS = 60_000;

interface GitResult {
  ok: boolean;
  output: string;
}

interface Repository {
  commonDir: string;
  root: string;
  prefix: string;
}

function git(cwd: string, args: readonly string[]): Effect.Effect<GitResult> {
  return Effect.tryPromise({
    catch: orchestratorError,
    try: () => execCommand("git", [...args], cwd, { timeout: GIT_TIMEOUT_MS }),
  }).pipe(
    Effect.map((result) => ({
      ok: result.code === 0,
      output: (result.code === 0 ? result.stdout : result.stderr).trim(),
    })),
    Effect.orElseSucceed(() => ({ ok: false, output: "" })),
  );
}

function required(
  cwd: string,
  args: readonly string[],
): Effect.Effect<string, runtimeTypes.OrchestratorError> {
  return Effect.flatMap(git(cwd, args), (result) =>
    result.ok
      ? Effect.succeed(result.output)
      : Effect.fail(orchestratorError(new Error(`git ${args.join(" ")}: ${result.output}`))),
  );
}

function shortId(taskId: string): string {
  return taskId.replace(/^t-/u, "");
}

function branchOf(taskId: string): string {
  return `task/${shortId(taskId)}`;
}

function repositoryOf(cwd: string): Effect.Effect<Repository | undefined> {
  return Effect.gen(function* () {
    const common = yield* git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const prefix = yield* git(cwd, ["rev-parse", "--show-prefix"]);
    if (!common.ok || !prefix.ok || platformPath.basename(common.output) !== ".git") {
      return undefined;
    }
    return {
      commonDir: common.output,
      prefix: prefix.output,
      root: platformPath.dirname(common.output),
    };
  });
}

function defaultBase(
  repository: Repository,
): Effect.Effect<string, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const remote = yield* git(repository.root, ["rev-parse", "--abbrev-ref", "origin/HEAD"]);
    if (remote.ok) return remote.output;
    return yield* required(repository.root, ["symbolic-ref", "--short", "HEAD"]);
  });
}

function branchExists(repository: Repository, branch: string): Effect.Effect<boolean> {
  return Effect.map(
    git(repository.root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]),
    (result) => result.ok,
  );
}

function ensureBranch(
  repository: Repository,
  branch: string,
  base: string,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    if (yield* branchExists(repository, branch)) return;
    const created = yield* git(repository.root, ["branch", "--no-track", branch, base]);
    if (created.ok || (yield* branchExists(repository, branch))) return;
    return yield* orchestratorError(new Error(`git branch ${branch} ${base}: ${created.output}`));
  });
}

function checkout(
  repository: Repository,
  path: string,
  branch: string,
  base: string,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const owner = yield* git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const current = yield* git(path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (owner.ok && owner.output === repository.commonDir && current.output === branch) return;
    if (owner.ok) {
      return yield* orchestratorError(
        new Error(`${path} already exists and is not the worktree of ${branch}`),
      );
    }
    yield* ensureBranch(repository, branch, base);
    yield* required(repository.root, ["worktree", "add", path, branch]);
  });
}

function upstreamName(base: string): string {
  return base.replace(/^origin\//u, "");
}

function targetOf(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): Effect.Effect<orchestratorTypesTypes.Task | null, runtimeTypes.OrchestratorError> {
  if (task.mergeInto === null) return Effect.succeed(null);
  const target = store.getTask(runtime.database, task.mergeInto);
  return target === undefined
    ? Effect.fail(orchestratorError(new Error(`Merge target ${task.mergeInto} no longer exists`)))
    : Effect.succeed(target);
}

function sourcesOf(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): orchestratorTypesTypes.WorkspaceSource[] {
  return store
    .listTasks(runtime.database, runtime.options.project)
    .filter((candidate) => candidate.mergeInto === task.id)
    .map((source) => ({ branch: branchOf(source.id), task: source }));
}

function prepare(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): Effect.Effect<orchestratorTypesTypes.Workspace, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const unmanaged = {
      branch: null,
      cwd: task.cwd,
      sources: [],
      target: null,
      targetBranch: null,
    };
    if (task.kind !== "work") return unmanaged;
    const repository = yield* repositoryOf(task.cwd);
    if (repository === undefined) return unmanaged;
    const target = yield* targetOf(runtime, task);
    const fallback = yield* defaultBase(repository);
    const targetBranch = target === null ? upstreamName(fallback) : branchOf(target.id);
    if (target !== null) yield* ensureBranch(repository, targetBranch, fallback);
    const branch = branchOf(task.id);
    const path = platformPath.join(
      platformPath.dirname(repository.root),
      `${platformPath.basename(repository.root)}-${shortId(task.id)}`,
    );
    yield* checkout(repository, path, branch, target === null ? fallback : targetBranch);
    return {
      branch,
      cwd: repository.prefix === "" ? path : platformPath.join(path, repository.prefix),
      sources: sourcesOf(runtime, task),
      target,
      targetBranch,
    };
  });
}

const worktrees = { branchOf, prepare };

const worktreeModule = {
  worktrees,
};

export default worktreeModule;
