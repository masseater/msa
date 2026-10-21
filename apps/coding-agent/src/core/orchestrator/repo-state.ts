import { Effect } from "effect";

import exec from "../exec.ts";
import errors from "./errors.ts";
import type repoStateTypes from "./repo-state.types.ts";

const { orchestratorError } = errors;
const { execCommand } = exec;

const EMPTY: repoStateTypes.RepoState = {
  branch: "-",
  changedFiles: 0,
  commit: "-",
  unpushedCommits: 0,
};

function git(cwd: string, args: readonly string[]): Effect.Effect<string | undefined> {
  return Effect.tryPromise({
    catch: orchestratorError,
    try: () => execCommand("git", [...args], cwd, { timeout: 5_000 }),
  }).pipe(
    Effect.map((result) => (result.code === 0 ? result.stdout.trim() : undefined)),
    Effect.orElseSucceed(() => undefined),
  );
}

function count(text: string | undefined): number {
  if (text === undefined || text === "") return 0;
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

function read(cwd: string): Effect.Effect<repoStateTypes.RepoState> {
  return Effect.gen(function* () {
    const branch = yield* git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = yield* git(cwd, ["log", "-1", "--format=%h %s"]);
    const status = yield* git(cwd, ["status", "--porcelain"]);
    const unpushed = yield* git(cwd, ["rev-list", "--count", "@{upstream}..HEAD"]);
    if (branch === undefined && commit === undefined) return EMPTY;
    return {
      branch: branch === undefined || branch === "" ? "-" : branch,
      changedFiles: count(status),
      commit: commit === undefined || commit === "" ? "-" : commit,
      unpushedCommits: Number.parseInt(unpushed ?? "0", 10) || 0,
    };
  });
}

function describe(state: repoStateTypes.RepoState): string {
  return `branch ${state.branch} · commit ${state.commit} · ${state.changedFiles} changed files · ${state.unpushedCommits} unpushed commits`;
}

const repoStates = { describe, read };

const repoState = {
  repoStates,
};

export default repoState;
