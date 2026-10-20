import testing from "@msa/testing";
import { Effect } from "effect";

const { joinPath, makeDirectory, writeTextFile } = testing;

const createPlainRepo = Effect.fn("createPlainRepo")(function* (tempDir: string) {
  const repoDir = joinPath(tempDir, "repo");
  yield* makeDirectory(joinPath(repoDir, ".git"));
  yield* writeTextFile(joinPath(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
  return repoDir;
});

const createReftableWorktree = Effect.fn("createReftableWorktree")(function* (tempDir: string) {
  const repoDir = joinPath(tempDir, "repo");
  const commonGitDir = joinPath(repoDir, ".git");
  const gitDir = joinPath(commonGitDir, "worktrees", "src");
  const worktreeDir = joinPath(tempDir, "worktree");
  const reftableDir = joinPath(commonGitDir, "reftable");
  yield* Effect.forEach([gitDir, reftableDir, worktreeDir], makeDirectory, { discard: true });
  yield* writeTextFile(joinPath(worktreeDir, ".git"), `gitdir: ${gitDir}\n`);
  yield* writeTextFile(joinPath(gitDir, "HEAD"), "ref: refs/heads/.invalid\n");
  yield* writeTextFile(joinPath(gitDir, "commondir"), "../..\n");
  yield* writeTextFile(joinPath(reftableDir, "tables.list"), "0\n");
  return { reftableDir, worktreeDir };
});

const footerDataProviderSupport = {
  createPlainRepo,
  createReftableWorktree,
};

export default footerDataProviderSupport;
