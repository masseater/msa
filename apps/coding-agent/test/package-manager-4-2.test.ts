import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import commandRunner from "../src/core/package-manager/command-runner.ts";
import platform from "../src/core/platform/index.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
const { readEnv } = platform;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeJsonFile } =
  testing;

let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldUseNpmcommandArgvForNpmInstalls = () =>
  runTest(
    Effect.gen(function* () {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "node@20", "--", "npm"],
      });
      packageManager = new DefaultPackageManager({
        agentDir,
        cwd: tempDir,
        settingsManager,
      });

      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(packageManager.operations.install.install("npm:@scope/pkg"));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "mise",
        [
          "exec",
          "node@20",
          "--",
          "npm",
          "install",
          "@scope/pkg",
          "--prefix",
          joinPath(agentDir, "npm"),
          "--legacy-peer-deps",
        ],
        undefined,
      );
    }),
  );

const shouldPassLegacyPeerDepsWhenUninstalling = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(agentDir, "npm"));
      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(packageManager.operations.install.remove("npm:@scope/pkg"));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        ["uninstall", "@scope/pkg", "--prefix", joinPath(agentDir, "npm"), "--legacy-peer-deps"],
        undefined,
      );
    }),
  );

const shouldUseBunCwdForNpmPackage = () =>
  runTest(
    Effect.gen(function* () {
      settingsManager = SettingsManager.inMemory({
        npmCommand: ["mise", "exec", "bun@1", "--", "bun"],
      });
      packageManager = new DefaultPackageManager({
        agentDir,
        cwd: tempDir,
        settingsManager,
      });

      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(packageManager.operations.install.install("npm:@scope/pkg"));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "mise",
        [
          "exec",
          "bun@1",
          "--",
          "bun",
          "install",
          "@scope/pkg",
          "--cwd",
          joinPath(agentDir, "npm"),
          "--omit=peer",
        ],
        undefined,
      );
    }),
  );

const shouldInstallGitPackageDependenciesWithoutAuto = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const source = "git:github.com/user/repo";
      const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
      const runCommandSpy = vi
        .spyOn(commandRunner, "runCommand")
        .mockImplementation((...callArgs: unknown[]) =>
          effectRunPromise(
            Effect.gen(function* () {
              const [command, args] = callArgs as [string, string[]];
              if (command === "git" && args[0] === "clone") {
                yield* makeDirectory(targetDir);
                yield* writeJsonFile(joinPath(targetDir, "package.json"), {
                  name: "repo",
                  version: "1.0.0",
                });
              }
            }),
          ),
        );

      yield* awaited(packageManager.operations.install.install(source));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        ["install", "--omit=dev", "--legacy-peer-deps"],
        {
          cwd: targetDir,
        },
      );
    }),
  );

const beforeEachHook3 = () =>
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

const afterEachHook3 = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook3);

  afterEach(afterEachHook3);

  describe("npmCommand", () => {
    it("should use npmCommand argv for npm installs", shouldUseNpmcommandArgvForNpmInstalls);

    it(
      "should pass legacy peer deps when uninstalling npm packages",
      shouldPassLegacyPeerDepsWhenUninstalling,
    );

    it("should use bun --cwd for npm package installs", shouldUseBunCwdForNpmPackage);

    it(
      "should install git package dependencies without auto-installing peers",
      shouldInstallGitPackageDependenciesWithoutAuto,
    );
  });
});
