import { Effect } from "effect";

import exec from "../exec.ts";
import platform from "../platform/index.ts";
import platformPath from "../platform/path.ts";
import errors from "./errors.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeSnapshot from "./worktree-snapshot.ts";
import worktreeModule from "./worktree.ts";

const { execCommand } = exec;
const { files } = platform;
const { orchestratorError } = errors;
const { worktrees } = worktreeModule;
const { store } = storeModule;

const GIT_TIMEOUT_MS = 60_000;
const ADVISOR_MARK = "msa-advisor-";
const WORK_LIMIT = 20_000;

function git(cwd: string, args: readonly string[]): Effect.Effect<{ ok: boolean; output: string }> {
  return Effect.tryPromise(() =>
    execCommand("git", [...args], cwd, { timeout: GIT_TIMEOUT_MS }),
  ).pipe(
    Effect.map((result) => ({
      ok: result.code === 0,
      output: (result.code === 0 ? result.stdout : result.stderr).trim(),
    })),
    Effect.orElseSucceed(() => ({ ok: false, output: "" })),
  );
}

function failed(message: string): Effect.Effect<never, runtimeTypes.OrchestratorError> {
  return Effect.fail(orchestratorError(new Error(message)));
}

function checkoutPath(root: string, threadId: string): string {
  return platformPath.join(
    platformPath.dirname(root),
    `${ADVISOR_MARK}${platformPath.basename(root)}-${threadId.replace(/^th-/u, "")}`,
  );
}

function copyFiles(source: string): Effect.Effect<string, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const paths = (yield* worktreeSnapshot.listFiles(source)) ?? [];
    const copy = yield* Effect.tryPromise({
      catch: orchestratorError,
      try: () => files.makeTempDirectory(ADVISOR_MARK),
    });
    for (const path of paths) {
      const to = platformPath.join(copy, path);
      yield* Effect.tryPromise({
        catch: orchestratorError,
        try: () => files.makeDirectory({ path: platformPath.dirname(to) }),
      });
      yield* Effect.tryPromise({
        catch: orchestratorError,
        try: () => files.copyFile({ from: platformPath.join(source, path), to }),
      });
    }
    return copy;
  });
}

function workDiff(
  root: string,
  commit: string,
  targetBranch: string | null,
): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    if (targetBranch === null) return undefined;
    for (const base of [targetBranch, `origin/${targetBranch}`]) {
      const fork = yield* git(root, ["merge-base", base, commit]);
      if (!fork.ok) continue;
      const diff = yield* git(root, [
        "diff",
        "--no-color",
        "--stat",
        "--patch",
        fork.output,
        commit,
      ]);
      if (!diff.ok) return undefined;
      const text = diff.output === "" ? `(no change from ${base})` : diff.output;
      return text.length <= WORK_LIMIT ? text : `${text.slice(0, WORK_LIMIT)}\n[…]`;
    }
    return undefined;
  });
}

function prepare(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  threadId: string,
): Effect.Effect<orchestratorTypesTypes.Workspace, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const source = yield* worktrees.prepare(runtime, task);
    const snapshot = yield* worktreeSnapshot.take(source.cwd);
    if (snapshot?.tree === undefined) return { ...source, cwd: yield* copyFiles(source.cwd) };
    const commit = yield* worktreeSnapshot.commitOf(snapshot);
    if (commit === undefined) {
      return yield* failed(
        `cannot commit the working tree of ${source.cwd} for a read-only checkout`,
      );
    }
    const path = checkoutPath(snapshot.root, threadId);
    const added = yield* git(snapshot.root, ["worktree", "add", "--detach", path, commit]);
    if (!added.ok) return yield* failed(`git worktree add --detach ${path}: ${added.output}`);
    const prefix = platformPath.relative(snapshot.root, source.cwd);
    const work = yield* workDiff(snapshot.root, commit, source.targetBranch);
    return {
      ...source,
      cwd: prefix === "" ? path : platformPath.join(path, prefix),
      ...(work === undefined ? {} : { work }),
    };
  });
}

function remove(cwd: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const top = yield* git(cwd, ["rev-parse", "--show-toplevel"]);
    const root = top.ok ? top.output : cwd;
    if (!platformPath.basename(root).startsWith(ADVISOR_MARK)) return;
    const common = top.ok
      ? yield* git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
      : undefined;
    const main = common?.ok === true ? platformPath.dirname(common.output) : undefined;
    if (main !== undefined) {
      const removed = yield* git(main, ["worktree", "remove", "--force", root]);
      if (removed.ok) return;
    }
    yield* Effect.tryPromise(() => files.remove({ force: true, path: root, recursive: true })).pipe(
      Effect.ignore,
    );
    if (main !== undefined) yield* git(main, ["worktree", "prune"]);
  });
}

function checkoutRoot(path: string): string | undefined {
  if (platformPath.basename(path).startsWith(ADVISOR_MARK)) return path;
  const parent = platformPath.dirname(path);
  return parent === path ? undefined : checkoutRoot(parent);
}

function registeredCheckouts(repository: string): Effect.Effect<Set<string>> {
  return Effect.map(git(repository, ["worktree", "list", "--porcelain"]), (listed) => {
    if (!listed.ok) return new Set<string>();
    const paths = listed.output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => platformPath.basename(line.slice("worktree ".length)));
    return new Set(paths.filter((name) => name.startsWith(ADVISOR_MARK)));
  });
}

function sweep(runtime: runtimeTypes.Runtime): Effect.Effect<void> {
  return Effect.gen(function* () {
    const byRepository = new Map<string, string[]>();
    for (const checkout of store.stoppedReadOnlyCheckouts(
      runtime.database,
      runtime.options.project,
    )) {
      const root = checkoutRoot(checkout.cwd);
      if (root === undefined) continue;
      byRepository.set(checkout.repository, [
        ...(byRepository.get(checkout.repository) ?? []),
        root,
      ]);
    }
    for (const [repository, roots] of byRepository) {
      const registered = yield* registeredCheckouts(repository);
      for (const root of roots) {
        if (registered.has(platformPath.basename(root))) {
          yield* git(repository, ["worktree", "remove", "--force", root]);
        }
        yield* Effect.tryPromise(() =>
          files.remove({ force: true, path: root, recursive: true }),
        ).pipe(Effect.ignore);
      }
    }
  });
}

const advisorWorkspace = { prepare, remove, sweep };

export default advisorWorkspace;
