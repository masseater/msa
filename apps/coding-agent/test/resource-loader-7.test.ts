import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { loadProjectContextFiles } from "../src/core/resource-loader.ts";

const {
  currentTimeMillis,
  joinPath,
  makeDirectory,
  makeSymlink,
  randomSuffixSync,
  removePath,
  runTest,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let cwd: string;

const linkWorktree = Effect.fn("linkWorktree")(function* (
  mainDir: string,
  worktreeDir: string,
  name: string,
) {
  const gitDir = joinPath(mainDir, ".git", "worktrees", name);
  yield* makeDirectory(gitDir);

  yield* writeTextFile(joinPath(mainDir, ".git", "HEAD"), "ref: refs/heads/main\n");
  yield* writeTextFile(joinPath(gitDir, "HEAD"), "ref: refs/heads/feat\n");

  yield* writeTextFile(joinPath(gitDir, "commondir"), "../..");
  yield* writeTextFile(joinPath(worktreeDir, ".git"), `gitdir: ${gitDir}\n`);
});

const setupNestedWorktree = Effect.gen(function* () {
  const outer = joinPath(tempDir, "outer");
  const main = joinPath(outer, "main");
  const worktree = joinPath(main, "worktrees", "feat");
  const worktreeSrc = joinPath(worktree, "src");
  yield* makeDirectory(worktreeSrc);
  yield* linkWorktree(main, worktree, "feat");
  return { main, outer, worktree, worktreeSrc };
});

const shouldSkipTheMainRepoSDuplicate = Effect.gen(function* () {
  const { main, worktree, worktreeSrc } = yield* setupNestedWorktree;
  yield* writeTextFile(joinPath(main, "AGENTS.md"), "main repo instructions");
  yield* writeTextFile(joinPath(worktree, "AGENTS.md"), "worktree instructions");

  const files = loadProjectContextFiles({ agentDir, cwd: worktreeSrc });

  expect(files.map((f) => f.content)).toEqual(["worktree instructions"]);
});

const shouldLoadTheWorktreeSContextOnce = Effect.gen(function* () {
  const { main, worktree, worktreeSrc } = yield* setupNestedWorktree;
  yield* writeTextFile(joinPath(main, "AGENTS.md"), "main repo instructions");
  yield* makeSymlink(joinPath(main, "AGENTS.md"), joinPath(worktree, "AGENTS.md"));

  const files = loadProjectContextFiles({ agentDir, cwd: worktreeSrc });

  expect(files.map((f) => f.path)).toEqual([joinPath(worktree, "AGENTS.md")]);
});

const shouldSkipTheMainRepoSDuplicate2 = Effect.gen(function* () {
  const { outer, main, worktree, worktreeSrc } = yield* setupNestedWorktree;
  const shared = joinPath(outer, "shared-agents.md");
  yield* writeTextFile(shared, "shared instructions");
  yield* makeSymlink(shared, joinPath(main, "AGENTS.md"));
  yield* makeSymlink(shared, joinPath(worktree, "AGENTS.md"));

  const files = loadProjectContextFiles({ agentDir, cwd: worktreeSrc });

  expect(files.map((f) => f.path)).toEqual([joinPath(worktree, "AGENTS.md")]);
});

const shouldStillInheritTheMainRepoS = Effect.gen(function* () {
  const { main, worktreeSrc } = yield* setupNestedWorktree;
  yield* writeTextFile(joinPath(main, "AGENTS.md"), "main repo instructions");

  const files = loadProjectContextFiles({ agentDir, cwd: worktreeSrc });

  expect(files.map((f) => f.content)).toEqual(["main repo instructions"]);
});

const shouldOnlySkipTheSameFilenameNot = Effect.gen(function* () {
  const { main, worktree, worktreeSrc } = yield* setupNestedWorktree;
  yield* writeTextFile(joinPath(main, "CLAUDE.md"), "main repo instructions");
  yield* writeTextFile(joinPath(worktree, "AGENTS.md"), "worktree instructions");

  const files = loadProjectContextFiles({ agentDir, cwd: worktreeSrc });

  expect(files.map((f) => f.content)).toEqual(["main repo instructions", "worktree instructions"]);
});

const shouldNotSkipTheContainerSContext = Effect.gen(function* () {
  const proj = joinPath(tempDir, "proj");
  const bare = joinPath(proj, ".bare");
  const worktree = joinPath(proj, "main");
  const worktreeGitDir = joinPath(bare, "worktrees", "main");
  yield* makeDirectory(worktreeGitDir);
  yield* makeDirectory(worktree);
  yield* writeTextFile(joinPath(bare, "HEAD"), "ref: refs/heads/main\n");
  yield* writeTextFile(joinPath(worktreeGitDir, "HEAD"), "ref: refs/heads/main\n");
  yield* writeTextFile(joinPath(worktreeGitDir, "commondir"), "../..");
  yield* writeTextFile(joinPath(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`);
  yield* writeTextFile(joinPath(proj, "AGENTS.md"), "container instructions");
  yield* writeTextFile(joinPath(worktree, "AGENTS.md"), "worktree instructions");

  const files = loadProjectContextFiles({ agentDir, cwd: worktree });

  expect(files.map((f) => f.content)).toEqual(["container instructions", "worktree instructions"]);
});

const shouldKeepLoadingAncestorsAboveTheMain = Effect.gen(function* () {
  const { outer, main, worktree, worktreeSrc } = yield* setupNestedWorktree;
  yield* writeTextFile(joinPath(outer, "AGENTS.md"), "outer instructions");
  yield* writeTextFile(joinPath(main, "AGENTS.md"), "main repo instructions");
  yield* writeTextFile(joinPath(worktree, "AGENTS.md"), "worktree instructions");

  const files = loadProjectContextFiles({ agentDir, cwd: worktreeSrc });

  expect(files.map((f) => f.content)).toEqual(["outer instructions", "worktree instructions"]);
});

const shouldNotSkipAnythingForASibling = Effect.gen(function* () {
  const outer = joinPath(tempDir, "outer");
  const main = joinPath(outer, "main");
  const sib = joinPath(outer, "sib-feat");
  const sibSrc = joinPath(sib, "src");
  yield* makeDirectory(sibSrc);
  yield* makeDirectory(main);
  yield* writeTextFile(joinPath(outer, "AGENTS.md"), "outer instructions");
  yield* writeTextFile(joinPath(sib, "AGENTS.md"), "sibling worktree instructions");
  yield* linkWorktree(main, sib, "sib");

  const files = loadProjectContextFiles({ agentDir, cwd: sibSrc });

  expect(files.map((f) => f.content)).toEqual([
    "outer instructions",
    "sibling worktree instructions",
  ]);
});

const shouldNotSkipTheSuperprojectSContext = Effect.gen(function* () {
  const sup = joinPath(tempDir, "super");
  const sub = joinPath(sup, "vendor", "lib");
  const subSrc = joinPath(sub, "src");
  yield* makeDirectory(subSrc);
  yield* writeTextFile(joinPath(sup, "AGENTS.md"), "superproject instructions");
  yield* writeTextFile(joinPath(sub, "AGENTS.md"), "submodule instructions");
  const subGitDir = joinPath(sup, ".git", "modules", "vendor", "lib");
  yield* makeDirectory(subGitDir);
  yield* writeTextFile(joinPath(subGitDir, "HEAD"), "ref: refs/heads/main\n");
  yield* writeTextFile(joinPath(sub, ".git"), `gitdir: ${subGitDir}\n`);

  const files = loadProjectContextFiles({ agentDir, cwd: subSrc });

  expect(files.map((f) => f.content)).toEqual([
    "superproject instructions",
    "submodule instructions",
  ]);
});

const shouldKeepClimbingPastAnOrdinaryRepo = Effect.gen(function* () {
  const outer = joinPath(tempDir, "outer");
  const repo = joinPath(outer, "repo");
  const leaf = joinPath(repo, "src");
  yield* makeDirectory(leaf);
  yield* makeDirectory(joinPath(repo, ".git"));
  yield* writeTextFile(joinPath(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  yield* writeTextFile(joinPath(outer, "AGENTS.md"), "outer instructions");
  yield* writeTextFile(joinPath(repo, "AGENTS.md"), "repo instructions");
  yield* writeTextFile(joinPath(leaf, "AGENTS.md"), "leaf instructions");

  const files = loadProjectContextFiles({ agentDir, cwd: leaf });

  expect(files.map((f) => f.content)).toEqual([
    "outer instructions",
    "repo instructions",
    "leaf instructions",
  ]);
});

const shouldClimbNormallyWhenTheGitdirTarget = Effect.gen(function* () {
  const repo = joinPath(tempDir, "corrupt");
  const src = joinPath(repo, "src");
  yield* makeDirectory(src);
  yield* writeTextFile(joinPath(repo, ".git"), "gitdir: /nonexistent/path/worktrees/feat\n");
  yield* writeTextFile(joinPath(repo, "AGENTS.md"), "repo instructions");
  yield* writeTextFile(joinPath(src, "AGENTS.md"), "src instructions");

  const files = loadProjectContextFiles({ agentDir, cwd: src });

  expect(files.map((f) => f.content)).toEqual(["repo instructions", "src instructions"]);
});

const beforeEachHook = Effect.gen(function* () {
  tempDir = joinPath(tmpdir(), `rl-test-${currentTimeMillis()}-${randomSuffixSync()}`);
  agentDir = joinPath(tempDir, "agent");
  cwd = joinPath(tempDir, "project");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(cwd);
});

describe("DefaultResourceLoader", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(removePath(tempDir)));

  describe("loadProjectContextFiles - nested worktree dedup", () => {
    it("should skip the main repo's duplicate when the worktree root has its own context", () =>
      runTest(shouldSkipTheMainRepoSDuplicate));

    it("should load the worktree's context once when it symlinks to the main repo's file", () =>
      runTest(shouldLoadTheWorktreeSContextOnce));

    it("should skip the main repo's duplicate when the main repo's file is a symlink", () =>
      runTest(shouldSkipTheMainRepoSDuplicate2));

    it("should still inherit the main repo's context when the worktree root has none", () =>
      runTest(shouldStillInheritTheMainRepoS));

    it("should only skip the same filename, not a differently named context file", () =>
      runTest(shouldOnlySkipTheSameFilenameNot));

    it("should NOT skip the container's context in a bare layout (proj/.bare + proj/main)", () =>
      runTest(shouldNotSkipTheContainerSContext));

    it("should keep loading ancestors above the main repo", () =>
      runTest(shouldKeepLoadingAncestorsAboveTheMain));

    it("should NOT skip anything for a sibling worktree (main repo is not an ancestor)", () =>
      runTest(shouldNotSkipAnythingForASibling));

    it("should NOT skip the superproject's context from inside a submodule", () =>
      runTest(shouldNotSkipTheSuperprojectSContext));

    it("should keep climbing past an ordinary repo root", () =>
      runTest(shouldKeepClimbingPastAnOrdinaryRepo));

    it("should climb normally when the gitdir: target does not exist", () =>
      runTest(shouldClimbNormallyWhenTheGitdirTarget));
  });
});
