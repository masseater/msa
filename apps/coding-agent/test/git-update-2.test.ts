import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import gitUpdateSupport from "./git-update-support.ts";
import testNetworkEnv from "./test-network-env.ts";

const { createCommit, getCurrentCommit, getFileContent, git, gitSource, initGitRepo } =
  gitUpdateSupport;

const { allowNetwork } = testNetworkEnv;

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  pathExists,
  randomSuffixSync,
  removePath,
  runTest,
} = testing;

let tempDir: string;

let remoteDir: string;

let agentDir: string;

let installedDir: string;

let settingsManager: SettingsManager;

let packageManager: DefaultPackageManager;

const shouldCheckoutTheConfiguredPinnedGitRef = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(remoteDir);
      yield* initGitRepo(remoteDir);
      const v1Commit = yield* createCommit(remoteDir, "extension.ts", "// v1", "Initial commit");
      yield* git(["tag", "v1"], remoteDir);
      const v2Commit = yield* createCommit(remoteDir, "extension.ts", "// v2", "Second commit");
      yield* git(["tag", "v2"], remoteDir);

      yield* makeDirectory(joinPath(agentDir, "git", "github.com", "test"));
      yield* git(["clone", remoteDir, installedDir], tempDir);
      yield* git(["checkout", "v1"], installedDir);
      expect(yield* getCurrentCommit(installedDir)).toBe(v1Commit);

      const pinnedSource = `${gitSource}@v2`;
      settingsManager.setPackages([pinnedSource]);

      yield* awaited(packageManager.update());

      expect(yield* getCurrentCommit(installedDir)).toBe(v2Commit);
      expect(yield* getFileContent(installedDir, "extension.ts")).toBe("// v2");

      yield* git(["checkout", "v1"], installedDir);

      yield* awaited(packageManager.update(pinnedSource));

      expect(yield* getCurrentCommit(installedDir)).toBe(v2Commit);
      expect(yield* getFileContent(installedDir, "extension.ts")).toBe("// v2");
    }),
  );

const beforeEachHook3 = () =>
  runTest(
    Effect.gen(function* () {
      allowNetwork();
      tempDir = joinPath(tmpdir(), `git-update-test-${currentTimeMillis()}-${randomSuffixSync()}`);
      yield* makeDirectory(tempDir);
      remoteDir = joinPath(tempDir, "remote");
      agentDir = joinPath(tempDir, "agent");
      installedDir = joinPath(agentDir, "git", "github.com", "test", "extension");
      yield* makeDirectory(agentDir);
      settingsManager = SettingsManager.inMemory();
      packageManager = new DefaultPackageManager({
        agentDir,
        cwd: tempDir,
        settingsManager,
      });
    }),
  );

const afterEachHook3 = () =>
  runTest(
    Effect.gen(function* () {
      if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
        yield* removePath(tempDir);
      }
    }),
  );

describe("DefaultPackageManager git update", () => {
  beforeEach(beforeEachHook3);

  afterEach(afterEachHook3);

  describe("pinned sources", () => {
    it(
      "should checkout the configured pinned git ref during full and targeted updates",
      shouldCheckoutTheConfiguredPinnedGitRef,
    );
  });
});
