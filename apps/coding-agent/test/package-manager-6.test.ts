import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import packageManagerFixture from "./package-manager-fixture.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeJsonFile, writeTextFile } =
  testing;

const shouldDetectPnpmThroughACorepackWrapper = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  fixture.useSettings({
    npmCommand: ["corepack", "pnpm"],
  });

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
    "corepack",
    [
      "pnpm",
      "install",
      "--prod",
      "--config.auto-install-peers=false",
      "--config.strict-peer-dependencies=false",
      "--config.strict-dep-builds=false",
    ],
    { cwd: targetDir },
  );
});

const shouldDisablePeerInstallationForGitPackage = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  fixture.useSettings({
    npmCommand: ["bun"],
  });

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

  expect(runCommandSpy).toHaveBeenCalledWith("bun", ["install", "--omit=dev", "--omit=peer"], {
    cwd: targetDir,
  });
});

const shouldUpdateGitPackageDependenciesWithoutAutoSetup = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const source = "git:github.com/user/repo";
    const targetDir = joinPath(fixture.tempDir, ".msa", "git", "github.com", "user", "repo");
    return { effectRunPromise, source, targetDir };
  });

const shouldUpdateGitPackageDependenciesWithoutAuto = Effect.gen(function* () {
  const { effectRunPromise, source, targetDir } =
    yield* shouldUpdateGitPackageDependenciesWithoutAutoSetup();
  yield* makeDirectory(targetDir);
  yield* writeTextFile(
    joinPath(targetDir, "package.json"),
    yield* toJsonText({ name: "repo", version: "1.0.0" }),
  );
  fixture.settingsManager.resources.setProjectPackages([source]);

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
  const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

  yield* awaited(fixture.packageManager.operations.updates.update(source));

  expect(runCommandSpy).toHaveBeenCalledWith(
    "npm",
    ["install", "--omit=dev", "--legacy-peer-deps"],
    {
      cwd: targetDir,
    },
  );
});

describe("DefaultPackageManager", () => {
  describe("npmCommand", () => {
    it("should detect pnpm through a corepack wrapper without a separator", () =>
      runTest(shouldDetectPnpmThroughACorepackWrapper));

    it("should disable peer installation for git package dependencies with bun", () =>
      runTest(shouldDisablePeerInstallationForGitPackage));

    it("should update git package dependencies without auto-installing peers", () =>
      runTest(shouldUpdateGitPackageDependenciesWithoutAuto));
  });
});
