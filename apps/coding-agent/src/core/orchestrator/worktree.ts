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

function taskBranch(runtime: runtimeTypes.Runtime, task: orchestratorTypesTypes.Task): string {
  return store.pullRequestOf(runtime.database, task.id)?.branch ?? branchOf(task.id);
}

function worktreePath(repository: Repository, branch: string): string {
  return platformPath.join(
    platformPath.dirname(repository.root),
    `${platformPath.basename(repository.root)}-${branch.replace(/^task\//u, "").replaceAll("/", "-")}`,
  );
}

function headOf(cwd: string): Effect.Effect<string | undefined> {
  return Effect.map(git(cwd, ["rev-parse", "HEAD"]), (result) =>
    result.ok ? result.output : undefined,
  );
}

function hasOrigin(cwd: string): Effect.Effect<boolean> {
  return Effect.map(git(cwd, ["remote", "get-url", "origin"]), (result) => result.ok);
}

function repositoryOf(cwd: string): Effect.Effect<Repository | undefined> {
  return Effect.gen(function* () {
    const found = yield* git(cwd, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
      "--show-prefix",
    ]);
    const [commonDir = "", prefix = ""] = found.output.split("\n");
    if (!found.ok || platformPath.basename(commonDir) !== ".git") return undefined;
    return { commonDir, prefix, root: platformPath.dirname(commonDir) };
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

function fetchBase(
  repository: Repository,
  base: string,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  if (!base.startsWith("origin/")) return Effect.void;
  return Effect.asVoid(
    required(repository.root, ["fetch", "--quiet", "origin", upstreamName(base)]),
  );
}

function ensureBranch(
  repository: Repository,
  branch: string,
  base: string,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    if (yield* branchExists(repository, branch)) return;
    yield* fetchBase(repository, base);
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
    const found = yield* git(path, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
      "--abbrev-ref",
      "HEAD",
    ]);
    const [owner, current] = found.output.split("\n");
    if (found.ok && owner === repository.commonDir && current === branch) return;
    if (found.ok) {
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
    .mergeSourcesOf(runtime.database, runtime.options.project, task.id)
    .map((source) => ({ branch: taskBranch(runtime, source), task: source }));
}

function removeWorktree(repository: Repository, branch: string): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const removed: string[] = [];
    const path = worktreePath(repository, branch);
    const current = yield* git(path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (current.ok && current.output === branch) {
      const worktree = yield* git(repository.root, ["worktree", "remove", "--force", path]);
      if (worktree.ok) removed.push(`worktree ${path}`);
    }
    if (yield* branchExists(repository, branch)) {
      const local = yield* git(repository.root, ["branch", "-D", branch]);
      if (local.ok) removed.push(`branch ${branch}`);
    }
    const remote = yield* git(repository.root, [
      "ls-remote",
      "--exit-code",
      "--heads",
      "origin",
      branch,
    ]);
    if (remote.ok) {
      const deleted = yield* git(repository.root, [
        "push",
        "--quiet",
        "origin",
        "--delete",
        branch,
      ]);
      if (deleted.ok) removed.push(`origin/${branch}`);
    }
    return removed;
  });
}

function cleanUp(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  branch: string,
): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const repository = yield* repositoryOf(task.cwd);
    if (repository === undefined) return [];
    const merged = store
      .listTasks(runtime.database, runtime.options.project)
      .filter((source) => source.mergeInto === task.id && source.status !== "running")
      .map((source) => taskBranch(runtime, source));
    const removed: string[] = [];
    for (const name of [branch, ...merged]) {
      removed.push(...(yield* removeWorktree(repository, name)));
    }
    return removed;
  });
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
    const targetBranch = target === null ? upstreamName(fallback) : taskBranch(runtime, target);
    if (target !== null) yield* ensureBranch(repository, targetBranch, fallback);
    const branch = taskBranch(runtime, task);
    const path = worktreePath(repository, branch);
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

const worktrees = { branchOf, cleanUp, hasOrigin, headOf, prepare };

const worktreeModule = {
  worktrees,
};

export default worktreeModule;
