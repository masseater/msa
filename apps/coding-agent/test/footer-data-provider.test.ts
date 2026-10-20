import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { FooterDataProvider } from "../src/core/footer-data-provider.ts";
import footerDataProviderSupport from "./footer-data-provider-support.ts";

const { createPlainRepo, createReftableWorktree } = footerDataProviderSupport;

const gitState = vi.hoisted(() => ({ branch: "main" }));

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(
    (
      _command: string,
      args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const branch = gitState.branch;
      queueMicrotask(() => {
        if (args[1] !== "symbolic-ref") {
          callback(new Error("unsupported"), "", "");
          return;
        }
        callback(
          branch.length > 0 ? null : new Error("detached"),
          branch.length > 0 ? `${branch}\n` : "",
          "",
        );
      });
    },
  ),
  spawnSync: vi.fn((_command: string, args: readonly string[]) => {
    const branch = gitState.branch;
    if (args[1] === "symbolic-ref") {
      return {
        status: branch.length > 0 ? 0 : 1,
        stderr: "",
        stdout: branch.length > 0 ? `${branch}\n` : "",
      };
    }
    return { status: 1, stderr: "", stdout: "" };
  }),
}));

vi.mock("child_process", () => childProcessMocks);

const { joinPath, makeDirectory, makeTempDir, pathExists, removePath, runTest, writeTextFile } =
  testing;

const createPlainReftableRepo = Effect.fn("createPlainReftableRepo")(function* (tempDir: string) {
  const repoDir = joinPath(tempDir, "repo");
  yield* makeDirectory(joinPath(repoDir, ".git", "reftable"));
  yield* writeTextFile(joinPath(repoDir, ".git", "HEAD"), "ref: refs/heads/.invalid\n");
  return repoDir;
});

let originalCwd: string;

let tempDir2: string;

const usesHeadDirectlyInARegularRepo = Effect.gen(function* () {
  const repoDir = yield* createPlainRepo(tempDir2);
  const nestedDir = joinPath(repoDir, "src", "nested");
  yield* makeDirectory(nestedDir);
  process.chdir(nestedDir);

  const provider = new FooterDataProvider(nestedDir);
  try {
    expect(provider.getGitBranch()).toBe("main");
    expect(childProcessMocks.spawnSync).not.toHaveBeenCalled();
  } finally {
    provider.dispose();
  }
});

const resolvesTheBranchViaGitWhenHead = Effect.gen(function* () {
  const repoDir = yield* createPlainReftableRepo(tempDir2);
  process.chdir(repoDir);

  const provider = new FooterDataProvider(repoDir);
  try {
    expect(provider.getGitBranch()).toBe("main");
    expect(childProcessMocks.spawnSync).toHaveBeenCalledWith(
      "git",
      ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
      expect.objectContaining({
        cwd: expect.stringMatching(/repo$/u),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } finally {
    provider.dispose();
  }
});

const resolvesTheBranchViaGitInA = Effect.gen(function* () {
  const { worktreeDir } = yield* createReftableWorktree(tempDir2);
  process.chdir(worktreeDir);

  const provider = new FooterDataProvider(worktreeDir);
  try {
    expect(provider.getGitBranch()).toBe("main");
  } finally {
    provider.dispose();
  }
});

const treatsAnUnresolvedInvalidReftableHeadAs = Effect.gen(function* () {
  const repoDir = yield* createPlainReftableRepo(tempDir2);
  process.chdir(repoDir);
  gitState.branch = "";

  const provider = new FooterDataProvider(repoDir);
  try {
    expect(provider.getGitBranch()).toBe("detached");
  } finally {
    provider.dispose();
  }
});

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      originalCwd = process.cwd();
      tempDir2 = yield* makeTempDir("footer-data-provider-");
      gitState.branch = "main";
      childProcessMocks.spawnSync.mockClear();
      childProcessMocks.execFile.mockClear();
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      process.chdir(originalCwd);
      if (tempDir2.length > 0 && (yield* pathExists(tempDir2))) {
        yield* removePath(tempDir2);
      }
    }),
  );

describe("FooterDataProvider reftable branch detection", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it("uses HEAD directly in a regular repo from a nested directory", () =>
    runTest(usesHeadDirectlyInARegularRepo));

  it("resolves the branch via git when HEAD is .invalid in a reftable repo", () =>
    runTest(resolvesTheBranchViaGitWhenHead));

  it("resolves the branch via git in a reftable-backed worktree", () =>
    runTest(resolvesTheBranchViaGitInA));

  it("treats an unresolved .invalid reftable HEAD as detached", () =>
    runTest(treatsAnUnresolvedInvalidReftableHeadAs));
});
