import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import gitUpdateSupport from "./git-update-support.ts";
const {
  createCommit,
  getCurrentCommit,
  getFileContent,
  git,
  gitSource,
  initGitRepo,
  runCommand,
  useGitUpdateFixture,
} = gitUpdateSupport;

const fx = useGitUpdateFixture();

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const setupRemoteAndInstall = Effect.fn("setupRemoteAndInstall")(function* () {
  yield* makeDirectory(fx.remoteDir);
  yield* initGitRepo(fx.remoteDir);
  yield* createCommit(fx.remoteDir, "extension.ts", "// v1", "Initial commit");

  yield* makeDirectory(joinPath(fx.agentDir, "git", "github.com", "test"));
  yield* git(["clone", fx.remoteDir, fx.installedDir], fx.tempDir);
  yield* git(["config", "--local", "user.email", "test@test.com"], fx.installedDir);
  yield* git(["config", "--local", "user.name", "Test"], fx.installedDir);

  fx.settingsManager.resources.setPackages([gitSource]);
});

const shouldSkipResetCleanAndInstallWhen = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(fx.remoteDir);
      yield* initGitRepo(fx.remoteDir);
      yield* writeTextFile(
        joinPath(fx.remoteDir, "package.json"),
        yield* toJsonText({ name: "test-extension", version: "1.0.0" }),
      );
      yield* createCommit(fx.remoteDir, "extension.ts", "// v1", "Initial commit");

      yield* makeDirectory(joinPath(fx.agentDir, "git", "github.com", "test"));
      yield* git(["clone", fx.remoteDir, fx.installedDir], fx.tempDir);
      fx.settingsManager.resources.setPackages([gitSource]);

      const executedCommands: string[] = [];
      commandRunner.runCommand = (command, args, options) => {
        executedCommands.push(`${command} ${args.join(" ")}`);
        if (command === "npm") return Promise.resolve();
        return runTest(Effect.asVoid(runCommand(command, args, options?.cwd ?? process.cwd())));
      };

      yield* awaited(fx.packageManager.operations.updates.update());

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
      expect(yield* getFileContent(fx.installedDir, "extension.ts")).toBe("// v1");

      const newCommit = yield* createCommit(fx.remoteDir, "extension.ts", "// v2", "Second commit");

      yield* awaited(fx.packageManager.operations.updates.update());

      expect(yield* getCurrentCommit(fx.installedDir)).toBe(newCommit);
      expect(yield* getFileContent(fx.installedDir, "extension.ts")).toBe("// v2");
    }),
  );

const shouldHandleCompleteHistoryRewrite = () =>
  runTest(
    Effect.gen(function* () {
      yield* setupRemoteAndInstall();

      yield* createCommit(fx.remoteDir, "extension.ts", "// v2", "v2");
      yield* createCommit(fx.remoteDir, "extension.ts", "// v3", "v3");

      yield* awaited(fx.packageManager.operations.updates.update());
      expect(yield* getFileContent(fx.installedDir, "extension.ts")).toBe("// v3");

      yield* git(["reset", "--hard", "HEAD~2"], fx.remoteDir);
      yield* createCommit(fx.remoteDir, "extension.ts", "// rewrite-a", "Rewrite A");
      const finalCommit = yield* createCommit(
        fx.remoteDir,
        "extension.ts",
        "// rewrite-b",
        "Rewrite B",
      );

      yield* awaited(fx.packageManager.operations.updates.update());

      expect(yield* getCurrentCommit(fx.installedDir)).toBe(finalCommit);
      expect(yield* getFileContent(fx.installedDir, "extension.ts")).toBe("// rewrite-b");
    }),
  );

describe("DefaultPackageManager git update", () => {
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
  describe("force-push scenarios", () => {
    it("should handle complete history rewrite", shouldHandleCompleteHistoryRewrite);
  });
});
