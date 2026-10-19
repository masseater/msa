import { Effect } from "effect";

import { execCommand } from "../exec.ts";
import { orchestratorError } from "./errors.ts";

export interface RepoState {
  branch: string;
  commit: string;
  changedFiles: number;
  unpushedCommits: number;
}

const EMPTY: RepoState = {
  branch: "-",
  commit: "-",
  changedFiles: 0,
  unpushedCommits: 0,
};

function git(cwd: string, args: readonly string[]): Effect.Effect<string | undefined> {
  return Effect.tryPromise({
    try: () => execCommand("git", [...args], cwd, { timeout: 5_000 }),
    catch: orchestratorError,
  }).pipe(
    Effect.map((result) => (result.code === 0 ? result.stdout.trim() : undefined)),
    Effect.orElseSucceed(() => undefined),
  );
}

function count(text: string | undefined): number {
  if (text === undefined || text === "") return 0;
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

function read(cwd: string): Effect.Effect<RepoState> {
  return Effect.gen(function* () {
    const branch = yield* git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = yield* git(cwd, ["log", "-1", "--format=%h %s"]);
    const status = yield* git(cwd, ["status", "--porcelain"]);
    const unpushed = yield* git(cwd, ["rev-list", "--count", "@{upstream}..HEAD"]);
    if (branch === undefined && commit === undefined) return EMPTY;
    return {
      branch: branch === undefined || branch === "" ? "-" : branch,
      commit: commit === undefined || commit === "" ? "-" : commit,
      changedFiles: count(status),
      unpushedCommits: Number.parseInt(unpushed ?? "0", 10) || 0,
    };
  });
}

function describe(state: RepoState): string {
  return `branch ${state.branch} · commit ${state.commit} · ${state.changedFiles} changed files · ${state.unpushedCommits} unpushed commits`;
}

export const repoStates = { read, describe };
