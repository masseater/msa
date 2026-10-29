import { Effect } from "effect";

import exec from "../exec.ts";
import errors from "./errors.ts";
import type worktreeGitTypes from "./worktree-git.types.ts";

const { orchestratorError } = errors;
const { execCommand } = exec;

const GIT_TIMEOUT_MS = 60_000;

type GitResult = worktreeGitTypes.GitResult;

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

function headOf(cwd: string): Effect.Effect<string | undefined> {
  return Effect.map(git(cwd, ["rev-parse", "HEAD"]), (result) =>
    result.ok ? result.output : undefined,
  );
}

function isWorkTree(cwd: string): Effect.Effect<boolean> {
  return Effect.map(
    git(cwd, ["rev-parse", "--is-inside-work-tree"]),
    (result) => result.ok && result.output === "true",
  );
}

function hasOrigin(cwd: string): Effect.Effect<boolean> {
  return Effect.map(git(cwd, ["remote", "get-url", "origin"]), (result) => result.ok);
}

const worktreeGit = { git, hasOrigin, headOf, isWorkTree };

export default worktreeGit;
