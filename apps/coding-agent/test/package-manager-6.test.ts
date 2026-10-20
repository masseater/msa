import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
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
  writeJsonFile,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldDetectPnpmThroughACorepackWrapper = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  settingsManager = SettingsManager.inMemory({
    npmCommand: ["corepack", "pnpm"],
  });
  packageManager = new DefaultPackageManager({
    agentDir,
    cwd: tempDir,
    settingsManager,
  });

  const source = "git:github.com/user/repo";
  const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
  const runCommandSpy = vi
    .spyOn(packageManager as any, "runCommand")
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

  yield* awaited(packageManager.install(source));

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

  settingsManager = SettingsManager.inMemory({
    npmCommand: ["bun"],
  });
  packageManager = new DefaultPackageManager({
    agentDir,
    cwd: tempDir,
    settingsManager,
  });

  const source = "git:github.com/user/repo";
  const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
  const runCommandSpy = vi
    .spyOn(packageManager as any, "runCommand")
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

  yield* awaited(packageManager.install(source));

  expect(runCommandSpy).toHaveBeenCalledWith("bun", ["install", "--omit=dev", "--omit=peer"], {
    cwd: targetDir,
  });
});

const shouldUpdateGitPackageDependenciesWithoutAutoPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const source = "git:github.com/user/repo";
    const targetDir = joinPath(tempDir, ".msa", "git", "github.com", "user", "repo");
    return { effectRunPromise, source, targetDir };
  });

const shouldUpdateGitPackageDependenciesWithoutAuto = Effect.gen(function* () {
  const { effectRunPromise, source, targetDir } =
    yield* shouldUpdateGitPackageDependenciesWithoutAutoPart1();
  yield* makeDirectory(targetDir);
  yield* writeTextFile(
    joinPath(targetDir, "package.json"),
    yield* toJsonText({ name: "repo", version: "1.0.0" }),
  );
  settingsManager.setProjectPackages([source]);

  vi.spyOn(packageManager as any, "runCommandCapture").mockImplementation(
    (...callArgs: unknown[]) =>
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
  const runCommandSpy = vi.spyOn(packageManager as any, "runCommand").mockResolvedValue(undefined);

  yield* awaited(packageManager.update(source));

  expect(runCommandSpy).toHaveBeenCalledWith(
    "npm",
    ["install", "--omit=dev", "--legacy-peer-deps"],
    {
      cwd: targetDir,
    },
  );
});

const beforeEachHook = Effect.gen(function* () {
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
});

const afterEachHook = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(afterEachHook);

  describe("npmCommand", () => {
    it("should detect pnpm through a corepack wrapper without a separator", () =>
      runTest(shouldDetectPnpmThroughACorepackWrapper));

    it("should disable peer installation for git package dependencies with bun", () =>
      runTest(shouldDisablePeerInstallationForGitPackage));

    it("should update git package dependencies without auto-installing peers", () =>
      runTest(shouldUpdateGitPackageDependenciesWithoutAuto));
  });
});
