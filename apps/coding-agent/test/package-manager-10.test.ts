import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import parsedSource from "./parsed-source.ts";

const { asGit } = parsedSource;
const { readEnv } = processEnv;

const { joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldDeduplicateGitUrlsWithDifferentSupported = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "https-dedup-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "test.ts"),
        "export default function() {}",
      );

      settingsManager.setPackages([
        "https://github.com/user/repo",
        "git:github.com/user/repo",
        "https://github.com/user/repo.git",
      ]);

      const id1 = packageManager.sources.getPackageIdentity("https://github.com/user/repo");
      const id2 = packageManager.sources.getPackageIdentity("git:github.com/user/repo");
      const id3 = packageManager.sources.getPackageIdentity("https://github.com/user/repo.git");

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    }),
  );

const shouldHandleHttpsUrlsWithRefsIn = () =>
  runTest(
    Effect.sync(() => {
      const parsed = asGit(packageManager.sources.parseSource("https://github.com/user/repo@main"));
      expect(parsed.ref).toBe("main");
      expect(parsed.pinned).toBe(true);

      const parsed2 = asGit(
        packageManager.sources.parseSource("https://github.com/user/repo@feature/branch"),
      );
      expect(parsed2.ref).toBe("feature/branch");
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      previousOfflineEnv = readEnv("MSA_OFFLINE");
      vi.stubEnv("MSA_OFFLINE", undefined);
      tempDir = yield* makeTempDir("pm-test-");
      agentDir = joinPath(tempDir, "agent");
      yield* makeDirectory(agentDir);

      settingsManager = SettingsManager.inMemory();
      packageManager = new DefaultPackageManager({
        agentDir,
        cwd: tempDir,
        settingsManager,
      });
    }),
  );

const afterEachHook = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("HTTPS git URL parsing (old behavior)", () => {
    it(
      "should deduplicate git URLs with different supported formats",
      shouldDeduplicateGitUrlsWithDifferentSupported,
    );

    it("should handle HTTPS URLs with refs in resolve", shouldHandleHttpsUrlsWithRefsIn);
  });
});
