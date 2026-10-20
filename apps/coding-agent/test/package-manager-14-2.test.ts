import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import commandRunner from "../src/core/package-manager/command-runner.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
const { readEnv } = processEnv;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldUpdateNpmRangePackagesUsingThe = () =>
  runTest(
    Effect.gen(function* () {
      const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      yield* makeDirectory(installedPath);
      yield* writeTextFile(
        joinPath(installedPath, "package.json"),
        yield* toJsonText({ name: "example", version: "1.0.0" }),
      );
      settingsManager.resources.setProjectPackages(["npm:example@^1.0.0"]);

      const runCommandCaptureSpy = vi
        .spyOn(commandRunner, "runCommandCapture")
        .mockResolvedValue('["1.0.0","1.2.0"]');
      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(packageManager.operations.updates.update("npm:example"));

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example@^1.0.0", "version", "--json"],
        expect.objectContaining({ cwd: tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        [
          "install",
          "example@^1.0.0",
          "--prefix",
          joinPath(tempDir, ".msa", "npm"),
          "--legacy-peer-deps",
        ],
        undefined,
      );
    }),
  );

const shouldSkipProjectNpmUpdateWhenInstalled = () =>
  runTest(
    Effect.gen(function* () {
      const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      yield* makeDirectory(installedPath);
      yield* writeTextFile(
        joinPath(installedPath, "package.json"),
        yield* toJsonText({ name: "example", version: "1.3.1" }),
      );
      settingsManager.resources.setProjectPackages(["npm:example@^1.0.0"]);

      const runCommandCaptureSpy = vi
        .spyOn(commandRunner, "runCommandCapture")
        .mockResolvedValue('["1.0.0","1.3.1","1.0.2"]');
      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(packageManager.operations.updates.update("npm:example"));

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example@^1.0.0", "version", "--json"],
        expect.objectContaining({ cwd: tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
    }),
  );

const shouldSkipNpmUpdatesWhenTheInstalled = () =>
  runTest(
    Effect.gen(function* () {
      const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
      yield* makeDirectory(installedPath);
      yield* writeTextFile(
        joinPath(installedPath, "package.json"),
        yield* toJsonText({ name: "example", version: "2.0.0" }),
      );
      settingsManager.resources.setProjectPackages(["npm:example"]);

      const runCommandCaptureSpy = vi
        .spyOn(commandRunner, "runCommandCapture")
        .mockResolvedValue('"1.9.0"');
      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(packageManager.operations.updates.update("npm:example"));

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example", "version", "--json"],
        expect.objectContaining({ cwd: tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
    }),
  );

const beforeEachHook2 = () =>
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

const afterEachHook2 = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook2);

  afterEach(afterEachHook2);

  describe("offline mode and network timeouts", () => {
    it(
      "should update npm range packages using the configured spec",
      shouldUpdateNpmRangePackagesUsingThe,
    );

    it(
      "should skip project npm update when installed version matches latest",
      shouldSkipProjectNpmUpdateWhenInstalled,
    );

    it(
      "should skip npm updates when the installed version is newer than the registry version",
      shouldSkipNpmUpdatesWhenTheInstalled,
    );
  });
});
