import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import gitUpdateSupport from "./git-update-support.ts";
import testNetworkEnv from "./test-network-env.ts";
const { createCommit, getCurrentCommit, getFileContent, git, gitSource, initGitRepo, runCommand } =
  gitUpdateSupport;

const { allowNetwork } = testNetworkEnv;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let remoteDir: string;

let agentDir: string;

let installedDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

const setupRemoteAndInstall = Effect.fn("setupRemoteAndInstall")(function* () {
  yield* makeDirectory(remoteDir);
  yield* initGitRepo(remoteDir);
  yield* createCommit(remoteDir, "extension.ts", "// v1", "Initial commit");

  yield* makeDirectory(joinPath(agentDir, "git", "github.com", "test"));
  yield* git(["clone", remoteDir, installedDir], tempDir);
  yield* git(["config", "--local", "user.email", "test@test.com"], installedDir);
  yield* git(["config", "--local", "user.name", "Test"], installedDir);

  settingsManager.setPackages([gitSource]);
});

const shouldSkipResetCleanAndInstallWhen = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(remoteDir);
      yield* initGitRepo(remoteDir);
      yield* writeTextFile(
        joinPath(remoteDir, "package.json"),
        yield* toJsonText({ name: "test-extension", version: "1.0.0" }),
      );
      yield* createCommit(remoteDir, "extension.ts", "// v1", "Initial commit");

      yield* makeDirectory(joinPath(agentDir, "git", "github.com", "test"));
      yield* git(["clone", remoteDir, installedDir], tempDir);
      settingsManager.setPackages([gitSource]);

      const executedCommands: string[] = [];
      const managerWithInternals = packageManager as unknown as {
        runCommand: (command: string, args: string[], options?: { cwd?: string }) => Promise<void>;
      };
      managerWithInternals.runCommand = (command, args, options) => {
        executedCommands.push(`${command} ${args.join(" ")}`);
        if (command === "npm") return Promise.resolve();
        return runTest(Effect.asVoid(runCommand(command, args, options?.cwd ?? process.cwd())));
      };

      yield* awaited(packageManager.update());

      expect(executedCommands).toContain(
        "git fetch --prune --no-tags origin +refs/heads/main:refs/remotes/origin/main",
      );
      expect(executedCommands).not.toContain("git fetch --prune origin");
      expect(executedCommands).not.toContain("git reset --hard @{upstream}");
      expect(executedCommands).not.toContain("git reset --hard origin/HEAD");
      expect(executedCommands).not.toContain("git clean -fdx");
      expect(executedCommands).not.toContain("npm install");
    }),
  );

const shouldUpdateToLatestCommitWhenRemote = () =>
  runTest(
    Effect.gen(function* () {
      yield* setupRemoteAndInstall();
      expect(yield* getFileContent(installedDir, "extension.ts")).toBe("// v1");

      const newCommit = yield* createCommit(remoteDir, "extension.ts", "// v2", "Second commit");

      yield* awaited(packageManager.update());

      expect(yield* getCurrentCommit(installedDir)).toBe(newCommit);
      expect(yield* getFileContent(installedDir, "extension.ts")).toBe("// v2");
    }),
  );

const shouldHandleCompleteHistoryRewrite = () =>
  runTest(
    Effect.gen(function* () {
      yield* setupRemoteAndInstall();

      yield* createCommit(remoteDir, "extension.ts", "// v2", "v2");
      yield* createCommit(remoteDir, "extension.ts", "// v3", "v3");

      yield* awaited(packageManager.update());
      expect(yield* getFileContent(installedDir, "extension.ts")).toBe("// v3");

      yield* git(["reset", "--hard", "HEAD~2"], remoteDir);
      yield* createCommit(remoteDir, "extension.ts", "// rewrite-a", "Rewrite A");
      const finalCommit = yield* createCommit(
        remoteDir,
        "extension.ts",
        "// rewrite-b",
        "Rewrite B",
      );

      yield* awaited(packageManager.update());

      expect(yield* getCurrentCommit(installedDir)).toBe(finalCommit);
      expect(yield* getFileContent(installedDir, "extension.ts")).toBe("// rewrite-b");
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      allowNetwork();
      tempDir = yield* makeTempDir("git-update-test-");
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

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
        yield* removePath(tempDir);
      }
    }),
  );

describe("DefaultPackageManager git update", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("normal updates (no force-push)", () => {
    it(
      "should skip reset, clean, and install when already up to date",
      shouldSkipResetCleanAndInstallWhen,
    );

    it(
      "should update to latest commit when remote has new commits",
      shouldUpdateToLatestCommitWhenRemote,
    );
  });
});

describe("DefaultPackageManager git update", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("force-push scenarios", () => {
    it("should handle complete history rewrite", shouldHandleCompleteHistoryRewrite);
  });
});
