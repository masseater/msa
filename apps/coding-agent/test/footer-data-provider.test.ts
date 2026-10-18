import { execFile, spawnSync } from "child_process";
import { existsSync, type FSWatcher, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

let resolvedBranch = "main";

vi.mock("child_process", () => ({
  execFile: vi.fn(
    (
      _command: string,
      args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (args[1] === "symbolic-ref") {
        setTimeout(
          () =>
            callback(
              resolvedBranch.length > 0 ? null : new Error("detached"),
              resolvedBranch.length > 0 ? `${resolvedBranch}\n` : "",
              "",
            ),
          0,
        );
        return;
      }
      setTimeout(() => callback(new Error("unsupported"), "", ""), 0);
    },
  ),
  spawnSync: vi.fn((_command: string, args: readonly string[]) => {
    if (args[1] === "symbolic-ref") {
      return {
        status: resolvedBranch.length > 0 ? 0 : 1,
        stdout: resolvedBranch.length > 0 ? `${resolvedBranch}\n` : "",
        stderr: "",
      };
    }
    return { status: 1, stdout: "", stderr: "" };
  }),
}));

import { awaited, runTest, currentTimeMillis, joinPath } from "@msa/testing";
import { Effect } from "effect";

import { FooterDataProvider } from "../src/core/footer-data-provider.ts";

type WorktreeFixture = {
  worktreeDir: string;
  reftableDir: string;
};

function createPlainReftableRepo(tempDir: string): string {
  const repoDir = joinPath(tempDir, "repo");
  mkdirSync(joinPath(repoDir, ".git", "reftable"), { recursive: true });
  writeFileSync(joinPath(repoDir, ".git", "HEAD"), "ref: refs/heads/.invalid\n");
  return repoDir;
}

function createPlainRepo(tempDir: string): string {
  const repoDir = joinPath(tempDir, "repo");
  mkdirSync(joinPath(repoDir, ".git"), { recursive: true });
  writeFileSync(joinPath(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
  return repoDir;
}

function createReftableWorktree(tempDir: string): WorktreeFixture {
  const repoDir = joinPath(tempDir, "repo");
  const commonGitDir = joinPath(repoDir, ".git");
  const gitDir = joinPath(commonGitDir, "worktrees", "src");
  const worktreeDir = joinPath(tempDir, "worktree");
  const reftableDir = joinPath(commonGitDir, "reftable");

  mkdirSync(gitDir, { recursive: true });
  mkdirSync(reftableDir, { recursive: true });
  mkdirSync(worktreeDir, { recursive: true });

  writeFileSync(joinPath(worktreeDir, ".git"), `gitdir: ${gitDir}\n`);
  writeFileSync(joinPath(gitDir, "HEAD"), "ref: refs/heads/.invalid\n");
  writeFileSync(joinPath(gitDir, "commondir"), "../..\n");
  writeFileSync(joinPath(reftableDir, "tables.list"), "0\n");

  return { worktreeDir, reftableDir };
}

function emitReftableChange(provider: FooterDataProvider): void {
  const { reftableWatcher } = provider as unknown as { reftableWatcher: FSWatcher | null };
  expect(reftableWatcher).not.toBeNull();
  reftableWatcher?.emit("change", "change", "tables.list");
}

function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  return runTest(
    Effect.gen(function* () {
      const startedAt = currentTimeMillis();
      while (!condition()) {
        if (currentTimeMillis() - startedAt > timeoutMs) {
          throw new Error("Timed out waiting for condition");
        }
        yield* Effect.sleep(10);
      }
    }),
  );
}

describe("FooterDataProvider reftable branch detection", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(joinPath(tmpdir(), "footer-data-provider-"));
    resolvedBranch = "main";
    vi.mocked(spawnSync).mockClear();
    vi.mocked(execFile).mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempDir.length > 0 && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses HEAD directly in a regular repo from a nested directory", () => {
    const repoDir = createPlainRepo(tempDir);
    const nestedDir = joinPath(repoDir, "src", "nested");
    mkdirSync(nestedDir, { recursive: true });
    process.chdir(nestedDir);

    const provider = new FooterDataProvider(nestedDir);
    try {
      expect(provider.getGitBranch()).toBe("main");
      expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
    } finally {
      provider.dispose();
    }
  });

  it("resolves the branch via git when HEAD is .invalid in a reftable repo", () => {
    const repoDir = createPlainReftableRepo(tempDir);
    process.chdir(repoDir);

    const provider = new FooterDataProvider(repoDir);
    try {
      expect(provider.getGitBranch()).toBe("main");
      expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
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

  it("resolves the branch via git in a reftable-backed worktree", () => {
    const { worktreeDir } = createReftableWorktree(tempDir);
    process.chdir(worktreeDir);

    const provider = new FooterDataProvider(worktreeDir);
    try {
      expect(provider.getGitBranch()).toBe("main");
    } finally {
      provider.dispose();
    }
  });

  it("treats an unresolved .invalid reftable HEAD as detached", () => {
    const repoDir = createPlainReftableRepo(tempDir);
    process.chdir(repoDir);
    resolvedBranch = "";

    const provider = new FooterDataProvider(repoDir);
    try {
      expect(provider.getGitBranch()).toBe("detached");
    } finally {
      provider.dispose();
    }
  });

  it("does not notify listeners when reftable updates keep the same branch", () =>
    runTest(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const { worktreeDir } = createReftableWorktree(tempDir);
        process.chdir(worktreeDir);

        const provider = new FooterDataProvider(worktreeDir);
        try {
          expect(provider.getGitBranch()).toBe("main");
          vi.mocked(spawnSync).mockClear();
          const onBranchChange = vi.fn();
          provider.onBranchChange(onBranchChange);

          emitReftableChange(provider);
          yield* awaited(vi.advanceTimersByTimeAsync(501));

          expect(vi.mocked(execFile)).toHaveBeenCalledTimes(1);
          expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
          expect(provider.getGitBranch()).toBe("main");
          expect(onBranchChange).not.toHaveBeenCalled();
        } finally {
          provider.dispose();
          vi.useRealTimers();
        }
      }),
    ));

  it("debounces rapid reftable updates into a single async refresh", () =>
    runTest(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const { worktreeDir } = createReftableWorktree(tempDir);
        process.chdir(worktreeDir);

        const provider = new FooterDataProvider(worktreeDir);
        try {
          expect(provider.getGitBranch()).toBe("main");
          vi.mocked(execFile).mockClear();

          emitReftableChange(provider);
          emitReftableChange(provider);
          emitReftableChange(provider);
          yield* awaited(vi.advanceTimersByTimeAsync(499));
          expect(vi.mocked(execFile)).not.toHaveBeenCalled();
          yield* awaited(vi.advanceTimersByTimeAsync(2));
          expect(vi.mocked(execFile)).toHaveBeenCalledTimes(1);
          yield* awaited(vi.advanceTimersByTimeAsync(650));
          expect(vi.mocked(execFile)).toHaveBeenCalledTimes(1);
        } finally {
          provider.dispose();
          vi.useRealTimers();
        }
      }),
    ));

  it("updates the cached branch when the reftable directory changes", () =>
    runTest(
      Effect.gen(function* () {
        const { worktreeDir, reftableDir } = createReftableWorktree(tempDir);
        process.chdir(worktreeDir);

        const provider = new FooterDataProvider(worktreeDir);
        try {
          expect(provider.getGitBranch()).toBe("main");
          resolvedBranch = "foo";
          const onBranchChange = vi.fn();
          provider.onBranchChange(onBranchChange);

          let generation = 0;
          yield* awaited(
            waitFor(() => {
              if (vi.mocked(execFile).mock.calls.length > 0) return true;
              generation += 1;
              writeFileSync(joinPath(reftableDir, "tables.list"), `${generation}\n`);
              return false;
            }, 10_000),
          );
          yield* awaited(waitFor(() => provider.getGitBranch() === "foo", 10_000));

          expect(provider.getGitBranch()).toBe("foo");
          expect(onBranchChange).toHaveBeenCalledTimes(1);
        } finally {
          provider.dispose();
        }
      }),
    ));

  it("retries git watchers 5 seconds after an async fs.watch error", () =>
    runTest(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const repoDir = createPlainRepo(tempDir);
        process.chdir(repoDir);

        const provider = new FooterDataProvider(repoDir);
        try {
          const providerWithInternals = provider as unknown as {
            headWatcher: FSWatcher | null;
          };
          const originalWatcher = providerWithInternals.headWatcher;
          expect(originalWatcher).not.toBeNull();
          expect(originalWatcher?.listenerCount("error")).toBeGreaterThan(0);

          originalWatcher?.emit("error", new Error("simulated EMFILE"));
          expect(providerWithInternals.headWatcher).toBeNull();

          yield* awaited(vi.advanceTimersByTimeAsync(4999));
          expect(providerWithInternals.headWatcher).toBeNull();

          yield* awaited(vi.advanceTimersByTimeAsync(1));
          expect(providerWithInternals.headWatcher).not.toBeNull();
          expect(providerWithInternals.headWatcher).not.toBe(originalWatcher);
        } finally {
          provider.dispose();
          vi.useRealTimers();
        }
      }),
    ));
});
