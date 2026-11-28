import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import packageManagerFixture from "./package-manager-fixture.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { awaited, joinPath, makeDirectory, runTest, writeJsonFile } = testing;

const shouldUseNpmcommandArgvForNpmInstalls = () =>
  runTest(
    Effect.gen(function* () {
      fixture.useSettings({
        npmCommand: ["mise", "exec", "node@20", "--", "npm"],
      });

      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(fixture.packageManager.operations.install.install("npm:@scope/pkg"));

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
          joinPath(fixture.agentDir, "npm"),
          "--legacy-peer-deps",
        ],
        undefined,
      );
    }),
  );

const shouldPassLegacyPeerDepsWhenUninstalling = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(fixture.agentDir, "npm"));
      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(fixture.packageManager.operations.install.remove("npm:@scope/pkg"));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        [
          "uninstall",
          "@scope/pkg",
          "--prefix",
          joinPath(fixture.agentDir, "npm"),
          "--legacy-peer-deps",
        ],
        undefined,
      );
    }),
  );

const shouldUseBunCwdForNpmPackage = () =>
  runTest(
    Effect.gen(function* () {
      fixture.useSettings({
        npmCommand: ["mise", "exec", "bun@1", "--", "bun"],
      });

      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(fixture.packageManager.operations.install.install("npm:@scope/pkg"));

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
          joinPath(fixture.agentDir, "npm"),
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
      const targetDir = joinPath(fixture.agentDir, "git", "github.com", "user", "repo");
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

      yield* awaited(fixture.packageManager.operations.install.install(source));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "npm",
        ["install", "--omit=dev", "--legacy-peer-deps"],
        {
          cwd: targetDir,
        },
      );
    }),
  );

describe("DefaultPackageManager", () => {
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
