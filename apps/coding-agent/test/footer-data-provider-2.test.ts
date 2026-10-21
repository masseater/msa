import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import FooterDataProvider from "../src/core/footer-data-provider.ts";
import type footerDataProviderTypes from "../src/core/footer-data-provider.types.ts";
import footerDataProviderSupport from "./footer-data-provider-support.ts";
const { createReftableWorktree } = footerDataProviderSupport;

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

vi.mock("child_process", (importOriginal) =>
  importOriginal<Record<string, unknown>>().then((actual) => ({ ...actual, ...childProcessMocks })),
);

interface WatcherHandle {
  emit(event: string, ...args: unknown[]): boolean;
  listenerCount(event: string): number;
}

const {
  awaited,
  joinPath,
  makeTempDir,
  pathExists,
  pollUntil,
  removePath,
  runTest,
  writeTextFile,
} = testing;

function emitReftableChange(provider: footerDataProviderTypes.FooterDataProvider): void {
  const { reftableWatcher } = provider.gitWatch as unknown as {
    reftableWatcher: WatcherHandle | null;
  };
  expect(reftableWatcher).not.toBeNull();
  reftableWatcher?.emit("change", "change", "tables.list");
}

const waitFor = (condition: Effect.Effect<boolean>) => pollUntil(condition, 1000, 10);

let originalCwd: string;

let tempDir2: string;

const doesNotNotifyListenersWhenReftableUpdates = () =>
  runTest(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const { worktreeDir } = yield* createReftableWorktree(tempDir2);
      process.chdir(worktreeDir);

      const provider = new FooterDataProvider(worktreeDir);
      try {
        expect(provider.getGitBranch()).toBe("main");
        childProcessMocks.spawnSync.mockClear();
        const onBranchChange = vi.fn();
        provider.onBranchChange(onBranchChange);

        emitReftableChange(provider);
        yield* awaited(vi.advanceTimersByTimeAsync(501));

        expect(childProcessMocks.execFile).toHaveBeenCalledTimes(1);
        expect(childProcessMocks.spawnSync).not.toHaveBeenCalled();
        expect(provider.getGitBranch()).toBe("main");
        expect(onBranchChange).not.toHaveBeenCalled();
      } finally {
        provider.dispose();
        vi.useRealTimers();
      }
    }),
  );

const debouncesRapidReftableUpdatesIntoASingle = () =>
  runTest(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const { worktreeDir } = yield* createReftableWorktree(tempDir2);
      process.chdir(worktreeDir);

      const provider = new FooterDataProvider(worktreeDir);
      try {
        expect(provider.getGitBranch()).toBe("main");
        childProcessMocks.execFile.mockClear();

        emitReftableChange(provider);
        emitReftableChange(provider);
        emitReftableChange(provider);
        yield* awaited(vi.advanceTimersByTimeAsync(499));
        expect(childProcessMocks.execFile).not.toHaveBeenCalled();
        yield* awaited(vi.advanceTimersByTimeAsync(2));
        expect(childProcessMocks.execFile).toHaveBeenCalledTimes(1);
        yield* awaited(vi.advanceTimersByTimeAsync(650));
        expect(childProcessMocks.execFile).toHaveBeenCalledTimes(1);
      } finally {
        provider.dispose();
        vi.useRealTimers();
      }
    }),
  );

const updatesTheCachedBranchWhenTheReftable = () =>
  runTest(
    Effect.gen(function* () {
      const { worktreeDir, reftableDir } = yield* createReftableWorktree(tempDir2);
      process.chdir(worktreeDir);

      const provider = new FooterDataProvider(worktreeDir);
      try {
        expect(provider.getGitBranch()).toBe("main");
        gitState.branch = "foo";
        const onBranchChange = vi.fn();
        provider.onBranchChange(onBranchChange);

        let generation = 0;
        yield* waitFor(
          Effect.gen(function* () {
            if (childProcessMocks.execFile.mock.calls.length > 0) return true;
            generation += 1;
            yield* writeTextFile(joinPath(reftableDir, "tables.list"), `${generation}\n`);
            return false;
          }),
        );
        yield* waitFor(Effect.sync(() => provider.getGitBranch() === "foo"));

        expect(provider.getGitBranch()).toBe("foo");
        expect(onBranchChange).toHaveBeenCalledTimes(1);
      } finally {
        provider.dispose();
      }
    }),
  );

const beforeEachHook2 = () =>
  runTest(
    Effect.gen(function* () {
      originalCwd = process.cwd();
      tempDir2 = yield* makeTempDir("footer-data-provider-");
      gitState.branch = "main";
      childProcessMocks.spawnSync.mockClear();
      childProcessMocks.execFile.mockClear();
    }),
  );

const afterEachHook2 = () =>
  runTest(
    Effect.gen(function* () {
      process.chdir(originalCwd);
      if (tempDir2.length > 0 && (yield* pathExists(tempDir2))) {
        yield* removePath(tempDir2);
      }
    }),
  );

describe("FooterDataProvider reftable branch detection", () => {
  beforeEach(beforeEachHook2);

  afterEach(afterEachHook2);

  it(
    "does not notify listeners when reftable updates keep the same branch",
    doesNotNotifyListenersWhenReftableUpdates,
  );

  it(
    "debounces rapid reftable updates into a single async refresh",
    debouncesRapidReftableUpdatesIntoASingle,
  );

  it(
    "updates the cached branch when the reftable directory changes",
    updatesTheCachedBranchWhenTheReftable,
  );
});
