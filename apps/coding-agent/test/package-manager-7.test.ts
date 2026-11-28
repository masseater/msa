import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import packageManagerFixture from "./package-manager-fixture.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeJsonFile, writeTextFile } =
  testing;

const installedUserPath = (source: string) =>
  Effect.promise(() => fixture.packageManager.configured.getInstalledPath(source, "user"));

const shouldDisablePeerInstallationThroughWrappedPnpmStep1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    fixture.useSettings({
      npmCommand: ["mise", "exec", "node@20", "--", "pnpm"],
    });

    const source = "git:github.com/user/repo";
    const targetDir = joinPath(fixture.tempDir, ".msa", "git", "github.com", "user", "repo");
    yield* makeDirectory(targetDir);
    yield* writeTextFile(
      joinPath(targetDir, "package.json"),
      yield* toJsonText({ name: "repo", version: "1.0.0" }),
    );
    fixture.settingsManager.resources.setProjectPackages([source]);
    return { effectRunPromise, source, targetDir };
  });

const shouldDisablePeerInstallationThroughWrappedPnpmStep2 = () =>
  Effect.gen(function* () {
    const { effectRunPromise, source, targetDir } =
      yield* shouldDisablePeerInstallationThroughWrappedPnpmStep1();

    vi.spyOn(commandRunner, "runCommandCapture").mockImplementation((...callArgs: unknown[]) =>
      effectRunPromise(
        Effect.gen(function* () {
          const [_command, args] = callArgs as [string, string[]];
          if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "@{upstream}") {
            return yield* awaited("origin/main");
          }
          if (
            args[0] === "rev-parse" &&
            (args[1] === "@{upstream}" || args[1] === "@{upstream}^{commit}")
          ) {
            return yield* awaited("remote-head");
          }
          if (args[0] === "rev-parse" && args[1] === "HEAD") {
            return yield* awaited("local-head");
          }
          throw new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`);
        }),
      ),
    );
    return { source, targetDir };
  });

const shouldDisablePeerInstallationThroughWrappedPnpm = () =>
  runTest(
    Effect.gen(function* () {
      const { source, targetDir } = yield* shouldDisablePeerInstallationThroughWrappedPnpmStep2();
      const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

      yield* awaited(fixture.packageManager.operations.updates.update(source));

      expect(runCommandSpy).toHaveBeenCalledWith(
        "mise",
        [
          "exec",
          "node@20",
          "--",
          "pnpm",
          "install",
          "--prod",
          "--config.auto-install-peers=false",
          "--config.strict-peer-dependencies=false",
          "--config.strict-dep-builds=false",
        ],
        { cwd: targetDir },
      );
    }),
  );

const useMiseNpmCommand = () => {
  fixture.useSettings({
    npmCommand: ["mise", "exec", "node@20", "--", "npm"],
  });
};

const shouldUseNpmcommandArgvForNpmRoot = Effect.gen(function* () {
  useMiseNpmCommand();

  const root20 = joinPath(fixture.tempDir, "node20", "lib", "node_modules");
  const root22 = joinPath(fixture.tempDir, "node22", "lib", "node_modules");
  yield* makeDirectory(joinPath(root20, "@scope", "pkg"));

  const runCommandSyncSpy = vi
    .spyOn(commandRunner, "runCommandSync")
    .mockImplementation((...callArgs: unknown[]) => {
      const [command, args] = callArgs as [string, string[]];
      if (command !== "mise") {
        throw new Error(`unexpected command ${command}`);
      }
      if (args[1] === "node@20") {
        return root20;
      }
      if (args[1] === "node@22") {
        return root22;
      }
      throw new Error(`unexpected args ${args.join(" ")}`);
    });

  expect(yield* installedUserPath("npm:@scope/pkg")).toBe(joinPath(root20, "@scope", "pkg"));
  expect(runCommandSyncSpy).toHaveBeenNthCalledWith(1, "mise", [
    "exec",
    "node@20",
    "--",
    "npm",
    "root",
    "-g",
  ]);

  fixture.settingsManager.resources.setNpmCommand(["mise", "exec", "node@22", "--", "npm"]);

  expect(yield* installedUserPath("npm:@scope/pkg")).toBeUndefined();
  expect(runCommandSyncSpy).toHaveBeenNthCalledWith(2, "mise", [
    "exec",
    "node@22",
    "--",
    "npm",
    "root",
    "-g",
  ]);
});

const shouldInstallUserNpmPackagesIntoTheSetup = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    fixture.useSettings({
      npmCommand: ["pnpm"],
      packages: ["npm:pnpm-pkg"],
    });

    const packagePath = joinPath(fixture.agentDir, "npm", "node_modules", "pnpm-pkg");
    vi.spyOn(commandRunner, "runCommandSync").mockImplementation(() => {
      throw new Error("legacy lookup unavailable");
    });
    return { effectRunPromise, packagePath };
  });

const shouldInstallUserNpmPackagesIntoThe = () =>
  runTest(
    Effect.gen(function* () {
      const { effectRunPromise, packagePath } = yield* shouldInstallUserNpmPackagesIntoTheSetup();
      const runCommandSpy = vi
        .spyOn(commandRunner, "runCommand")
        .mockImplementation((...callArgs: unknown[]) =>
          effectRunPromise(
            Effect.gen(function* () {
              const [command, args] = callArgs as [string, string[]];
              expect(command).toBe("pnpm");
              expect(args).toEqual([
                "install",
                "pnpm-pkg",
                "--prefix",
                joinPath(fixture.agentDir, "npm"),
                "--config.auto-install-peers=false",
                "--config.strict-peer-dependencies=false",
                "--config.strict-dep-builds=false",
              ]);
              yield* makeDirectory(joinPath(packagePath, "extensions"));
              yield* writeJsonFile(joinPath(packagePath, "package.json"), {
                name: "pnpm-pkg",
                version: "1.0.0",
              });
              yield* writeTextFile(
                joinPath(packagePath, "extensions", "index.ts"),
                "export default function() {};",
              );
            }),
          ),
        );

      const first = yield* awaited(fixture.packageManager.resolution.resolve());
      const second = yield* awaited(fixture.packageManager.resolution.resolve());

      expect(
        first.extensions.some(
          (r) => r.path === joinPath(packagePath, "extensions", "index.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(
        second.extensions.some(
          (r) => r.path === joinPath(packagePath, "extensions", "index.ts") && r.enabled,
        ),
      ).toBe(true);
      expect(runCommandSpy).toHaveBeenCalledTimes(1);
      expect(yield* installedUserPath("npm:pnpm-pkg")).toBe(packagePath);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("npmCommand", () => {
    it(
      "should disable peer installation through wrapped pnpm when updating git dependencies",
      shouldDisablePeerInstallationThroughWrappedPnpm,
    );

    it("should use npmCommand argv for npm root lookup and invalidate cached root when npmCommand changes", () =>
      runTest(shouldUseNpmcommandArgvForNpmRoot));

    it(
      "should install user npm packages into the msa-managed npm root",
      shouldInstallUserNpmPackagesIntoThe,
    );
  });
});
