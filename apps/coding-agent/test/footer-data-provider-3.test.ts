import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import FooterDataProvider from "../src/core/footer-data-provider.ts";
import footerDataProviderSupport from "./footer-data-provider-support.ts";
const { createPlainRepo } = footerDataProviderSupport;

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
  emit(event: string, error: Error): boolean;
  listenerCount(event: string): number;
}

const { awaited, makeTempDir, pathExists, removePath, runTest } = testing;

let originalCwd: string;

let tempDir2: string;

const retriesGitWatchers5SecondsAfterAn = () =>
  runTest(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const repoDir = yield* createPlainRepo(tempDir2);
      process.chdir(repoDir);

      const provider = new FooterDataProvider(repoDir);
      try {
        const providerWithInternals = provider as unknown as {
          headWatcher: WatcherHandle | null;
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
  );

const beforeEachHook3 = () =>
  runTest(
    Effect.gen(function* () {
      originalCwd = process.cwd();
      tempDir2 = yield* makeTempDir("footer-data-provider-");
      gitState.branch = "main";
      childProcessMocks.spawnSync.mockClear();
      childProcessMocks.execFile.mockClear();
    }),
  );

const afterEachHook3 = () =>
  runTest(
    Effect.gen(function* () {
      process.chdir(originalCwd);
      if (tempDir2.length > 0 && (yield* pathExists(tempDir2))) {
        yield* removePath(tempDir2);
      }
    }),
  );

describe("FooterDataProvider reftable branch detection", () => {
  beforeEach(beforeEachHook3);

  afterEach(afterEachHook3);

  it(
    "retries git watchers 5 seconds after an async fs.watch error",
    retriesGitWatchers5SecondsAfterAn,
  );
});
