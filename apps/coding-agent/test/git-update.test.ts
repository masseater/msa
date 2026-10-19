import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  awaited,
  runTest,
  currentTimeMillis,
  toJsonText,
  randomSuffixSync,
  writeTextFile,
  makeDirectory,
  removePath,
  joinPath,
  pathExists,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { allowNetwork } from "./test-network-env.ts";

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: git ${args.join(" ")}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function initGitRepo(repoDir: string): void {
  git(["init", "--initial-branch=main"], repoDir);
  git(["config", "--local", "user.email", "test@test.com"], repoDir);
  git(["config", "--local", "user.name", "Test"], repoDir);
}

function createCommit(repoDir: string, filename: string, content: string, message: string): string {
  writeFileSync(joinPath(repoDir, filename), content);
  git(["add", filename], repoDir);
  git(["commit", "-m", message], repoDir);
  return git(["rev-parse", "HEAD"], repoDir);
}

function getCurrentCommit(repoDir: string): string {
  return git(["rev-parse", "HEAD"], repoDir);
}

function getFileContent(repoDir: string, filename: string): string {
  return readFileSync(joinPath(repoDir, filename), "utf-8");
}

type GitSourceForTest = {
  type: "git";
  repo: string;
  host: string;
  path: string;
  pinned: boolean;
  ref?: string;
};

interface PackageManagerPathInternals {
  parseSource(source: string): GitSourceForTest;
  getGitInstallPath(source: GitSourceForTest, scope: "temporary"): string;
}

describe("DefaultPackageManager git update", () => {
  let tempDir: string;
  let remoteDir: string;
  let agentDir: string;
  let installedDir: string;
  let settingsManager: SettingsManager;
  let packageManager: DefaultPackageManager;

  const gitSource = "git:github.com/test/extension";

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        allowNetwork();
        tempDir = joinPath(
          tmpdir(),
          `git-update-test-${currentTimeMillis()}-${randomSuffixSync()}`,
        );
        yield* makeDirectory(tempDir);
        remoteDir = joinPath(tempDir, "remote");
        agentDir = joinPath(tempDir, "agent");
        installedDir = joinPath(agentDir, "git", "github.com", "test", "extension");
        yield* makeDirectory(agentDir);
        settingsManager = SettingsManager.inMemory();
        packageManager = new DefaultPackageManager({
          cwd: tempDir,
          agentDir,
          settingsManager,
        });
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
          yield* removePath(tempDir);
        }
      }),
    ),
  );

  function setupRemoteAndInstall(): void {
    mkdirSync(remoteDir, { recursive: true });
    initGitRepo(remoteDir);
    createCommit(remoteDir, "extension.ts", "// v1", "Initial commit");

    mkdirSync(joinPath(agentDir, "git", "github.com", "test"), { recursive: true });
    git(["clone", remoteDir, installedDir], tempDir);
    git(["config", "--local", "user.email", "test@test.com"], installedDir);
    git(["config", "--local", "user.name", "Test"], installedDir);

    settingsManager.setPackages([gitSource]);
  }

  describe("normal updates (no force-push)", () => {
    it("should skip reset, clean, and install when already up to date", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* makeDirectory(remoteDir);
          initGitRepo(remoteDir);
          yield* writeTextFile(
            joinPath(remoteDir, "package.json"),
            yield* toJsonText({ name: "test-extension", version: "1.0.0" }),
          );
          createCommit(remoteDir, "extension.ts", "// v1", "Initial commit");

          yield* makeDirectory(joinPath(agentDir, "git", "github.com", "test"));
          git(["clone", remoteDir, installedDir], tempDir);
          settingsManager.setPackages([gitSource]);

          const executedCommands: string[] = [];
          const managerWithInternals = packageManager as unknown as {
            runCommand: (
              command: string,
              args: string[],
              options?: { cwd?: string },
            ) => Promise<void>;
          };
          managerWithInternals.runCommand = (command, args, options) =>
            effectRunPromise(
              Effect.sync(() => {
                executedCommands.push(`${command} ${args.join(" ")}`);
                if (command === "npm") {
                  return;
                }
                const result = spawnSync(command, args, {
                  cwd: options?.cwd,
                  encoding: "utf-8",
                });
                if (result.status !== 0) {
                  throw new Error(`Command failed: ${command} ${args.join(" ")}\n${result.stderr}`);
                }
              }),
            );

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
      ));

    it("should update to latest commit when remote has new commits", () =>
      runTest(
        Effect.gen(function* () {
          setupRemoteAndInstall();
          expect(getFileContent(installedDir, "extension.ts")).toBe("// v1");

          const newCommit = createCommit(remoteDir, "extension.ts", "// v2", "Second commit");

          yield* awaited(packageManager.update());

          expect(getCurrentCommit(installedDir)).toBe(newCommit);
          expect(getFileContent(installedDir, "extension.ts")).toBe("// v2");
        }),
      ));
  });

  describe("force-push scenarios", () => {
    it("should handle complete history rewrite", () =>
      runTest(
        Effect.gen(function* () {
          setupRemoteAndInstall();

          createCommit(remoteDir, "extension.ts", "// v2", "v2");
          createCommit(remoteDir, "extension.ts", "// v3", "v3");

          yield* awaited(packageManager.update());
          expect(getFileContent(installedDir, "extension.ts")).toBe("// v3");

          git(["reset", "--hard", "HEAD~2"], remoteDir);
          createCommit(remoteDir, "extension.ts", "// rewrite-a", "Rewrite A");
          const finalCommit = createCommit(remoteDir, "extension.ts", "// rewrite-b", "Rewrite B");

          yield* awaited(packageManager.update());

          expect(getCurrentCommit(installedDir)).toBe(finalCommit);
          expect(getFileContent(installedDir, "extension.ts")).toBe("// rewrite-b");
        }),
      ));
  });

  describe("pinned sources", () => {
    it("should checkout the configured pinned git ref during full and targeted updates", () =>
      runTest(
        Effect.gen(function* () {
          yield* makeDirectory(remoteDir);
          initGitRepo(remoteDir);
          const v1Commit = createCommit(remoteDir, "extension.ts", "// v1", "Initial commit");
          git(["tag", "v1"], remoteDir);
          const v2Commit = createCommit(remoteDir, "extension.ts", "// v2", "Second commit");
          git(["tag", "v2"], remoteDir);

          yield* makeDirectory(joinPath(agentDir, "git", "github.com", "test"));
          git(["clone", remoteDir, installedDir], tempDir);
          git(["checkout", "v1"], installedDir);
          expect(getCurrentCommit(installedDir)).toBe(v1Commit);

          const pinnedSource = `${gitSource}@v2`;
          settingsManager.setPackages([pinnedSource]);

          yield* awaited(packageManager.update());

          expect(getCurrentCommit(installedDir)).toBe(v2Commit);
          expect(getFileContent(installedDir, "extension.ts")).toBe("// v2");

          git(["checkout", "v1"], installedDir);

          yield* awaited(packageManager.update(pinnedSource));

          expect(getCurrentCommit(installedDir)).toBe(v2Commit);
          expect(getFileContent(installedDir, "extension.ts")).toBe("// v2");
        }),
      ));
  });

  describe("temporary git sources", () => {
    it("should refresh cached temporary git sources when resolving", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const managerWithPaths = packageManager as unknown as PackageManagerPathInternals;
          const cachedDir = managerWithPaths.getGitInstallPath(
            managerWithPaths.parseSource(gitSource),
            "temporary",
          );
          const extensionFile = joinPath(cachedDir, "msa-extensions", "session-breakdown.ts");

          yield* removePath(cachedDir);
          yield* makeDirectory(joinPath(cachedDir, "msa-extensions"));
          yield* writeTextFile(
            joinPath(cachedDir, "package.json"),
            JSON.stringify({ msa: { extensions: ["./msa-extensions"] } }, null, 2),
          );
          yield* writeTextFile(extensionFile, "// stale");

          const executedCommands: string[] = [];
          const managerWithInternals = packageManager as unknown as {
            runCommand: (
              command: string,
              args: string[],
              options?: { cwd?: string },
            ) => Promise<void>;
            runCommandCapture: (
              command: string,
              args: string[],
              options?: { cwd?: string },
            ) => Promise<string>;
          };
          managerWithInternals.runCommand = (command, args) =>
            effectRunPromise(
              Effect.sync(() => {
                executedCommands.push(`${command} ${args.join(" ")}`);
                if (command === "git" && args[0] === "reset") {
                  writeFileSync(extensionFile, "// fresh");
                }
              }),
            );
          managerWithInternals.runCommandCapture = (_command, args) =>
            effectRunPromise(
              Effect.gen(function* () {
                if (args[0] === "rev-parse" && args[1] === "HEAD") {
                  return yield* awaited("local-head");
                }
                if (args[0] === "rev-parse" && args[1] === "@{upstream}") {
                  return yield* awaited("remote-head");
                }
                if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
                  return yield* awaited("origin/main");
                }
                return yield* awaited("");
              }),
            );

          yield* awaited(packageManager.resolveExtensionSources([gitSource], { temporary: true }));

          expect(executedCommands).toContain(
            "git fetch --prune --no-tags origin +refs/heads/main:refs/remotes/origin/main",
          );
          expect(getFileContent(cachedDir, "msa-extensions/session-breakdown.ts")).toBe("// fresh");
        }),
      ));
  });
});
