import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import packageManagerFixture from "./package-manager-fixture.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const shouldUpdateNpmRangePackagesUsingThe = () =>
  runTest(
    Effect.gen(function* () {
      const installedPath = joinPath(fixture.tempDir, ".msa", "npm", "node_modules", "example");
      yield* makeDirectory(installedPath);
      yield* writeTextFile(
        joinPath(installedPath, "package.json"),
        yield* toJsonText({ name: "example", version: "1.0.0" }),
      );
      fixture.settingsManager.resources.setProjectPackages(["npm:example@^1.0.0"]);

      const runCommandCaptureSpy = vi
        .spyOn(commandRunner, "runCommandCapture")
        .mockResolvedValue('["1.0.0","1.2.0"]');
      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(fixture.packageManager.operations.updates.update("npm:example"));

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example@^1.0.0", "version", "--json"],
        expect.objectContaining({ cwd: fixture.tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        [
          "install",
          "example@^1.0.0",
          "--prefix",
          joinPath(fixture.tempDir, ".msa", "npm"),
          "--legacy-peer-deps",
        ],
        undefined,
      );
    }),
  );

const shouldSkipProjectNpmUpdateWhenInstalled = () =>
  runTest(
    Effect.gen(function* () {
      const installedPath = joinPath(fixture.tempDir, ".msa", "npm", "node_modules", "example");
      yield* makeDirectory(installedPath);
      yield* writeTextFile(
        joinPath(installedPath, "package.json"),
        yield* toJsonText({ name: "example", version: "1.3.1" }),
      );
      fixture.settingsManager.resources.setProjectPackages(["npm:example@^1.0.0"]);

      const runCommandCaptureSpy = vi
        .spyOn(commandRunner, "runCommandCapture")
        .mockResolvedValue('["1.0.0","1.3.1","1.0.2"]');
      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(fixture.packageManager.operations.updates.update("npm:example"));

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example@^1.0.0", "version", "--json"],
        expect.objectContaining({ cwd: fixture.tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
    }),
  );

const shouldSkipNpmUpdatesWhenTheInstalled = () =>
  runTest(
    Effect.gen(function* () {
      const installedPath = joinPath(fixture.tempDir, ".msa", "npm", "node_modules", "example");
      yield* makeDirectory(installedPath);
      yield* writeTextFile(
        joinPath(installedPath, "package.json"),
        yield* toJsonText({ name: "example", version: "2.0.0" }),
      );
      fixture.settingsManager.resources.setProjectPackages(["npm:example"]);

      const runCommandCaptureSpy = vi
        .spyOn(commandRunner, "runCommandCapture")
        .mockResolvedValue('"1.9.0"');
      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(fixture.packageManager.operations.updates.update("npm:example"));

      expect(runCommandCaptureSpy).toHaveBeenCalledWith(
        "npm",
        ["view", "example", "version", "--json"],
        expect.objectContaining({ cwd: fixture.tempDir, timeoutMs: expect.any(Number) }),
      );
      expect(runCommandSpy).not.toHaveBeenCalled();
    }),
  );

describe("DefaultPackageManager", () => {
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
