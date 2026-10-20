import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import type packageManagerSupportTypes from "./package-manager-support.types.ts";
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

const shouldRepairMissingGitPackageDependenciesWhen = Effect.gen(function* () {
  const source = "git:github.com/user/repo";
  const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
  const fetchArgs = [
    "fetch",
    "--prune",
    "--no-tags",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
  ];
  yield* makeDirectory(targetDir);
  yield* writeTextFile(
    joinPath(targetDir, "package.json"),
    yield* toJsonText({
      dependencies: { dependency: "1.0.0" },
      name: "repo",
      version: "1.0.0",
    }),
  );
  settingsManager.setPackages([source]);

  const managerWithInternals =
    packageManager as unknown as packageManagerSupportTypes.PackageManagerInternals;
  vi.spyOn(managerWithInternals, "getLocalGitUpdateTarget").mockResolvedValue({
    fetchArgs,
    head: "current-head",
    ref: "@{upstream}",
  });
  vi.spyOn(managerWithInternals, "runCommandCapture").mockResolvedValue("current-head");
  const runCommandSpy = vi.spyOn(managerWithInternals, "runCommand").mockResolvedValue(undefined);

  yield* awaited(packageManager.update(source));

  expect(runCommandSpy).toHaveBeenCalledWith(
    "npm",
    ["install", "--omit=dev", "--legacy-peer-deps"],
    {
      cwd: targetDir,
    },
  );
  expect(runCommandSpy).not.toHaveBeenCalledWith("git", ["clean", "-fdx"], {
    cwd: targetDir,
  });
});

const shouldRepairDeletedGitPackageDependenciesWhenPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const source = "git:github.com/user/repo";
    const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
    const fetchArgs = [
      "fetch",
      "--prune",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ];
    return { effectRunPromise, fetchArgs, source, targetDir };
  });

const shouldRepairDeletedGitPackageDependenciesWhen = Effect.gen(function* () {
  const { effectRunPromise, fetchArgs, source, targetDir } =
    yield* shouldRepairDeletedGitPackageDependenciesWhenPart1();
  yield* makeDirectory(targetDir);
  yield* writeTextFile(
    joinPath(targetDir, "package.json"),
    yield* toJsonText({
      dependencies: { dependency: "1.0.0" },
      name: "repo",
      version: "1.0.0",
    }),
  );
  settingsManager.setPackages([source]);

  const managerWithInternals =
    packageManager as unknown as packageManagerSupportTypes.PackageManagerInternals;
  vi.spyOn(managerWithInternals, "getLocalGitUpdateTarget").mockResolvedValue({
    fetchArgs,
    head: "new-head",
    ref: "@{upstream}",
  });
  vi.spyOn(managerWithInternals, "runCommandCapture").mockImplementation((_command, args) =>
    effectRunPromise(awaited(args[1] === "HEAD" ? "old-head" : "new-head")),
  );
  const runCommandSpy = vi
    .spyOn(managerWithInternals, "runCommand")
    .mockImplementation((_command, args) =>
      effectRunPromise(
        Effect.sync(() => {
          if (args[0] === "clean") throw new Error("simulated clean failure");
        }),
      ),
    );

  yield* awaited(expect(packageManager.update(source)).rejects.toThrow("simulated clean failure"));

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
    it("should repair missing git package dependencies when the checkout is already current", () =>
      runTest(shouldRepairMissingGitPackageDependenciesWhen));

    it("should repair deleted git package dependencies when cleaning fails", () =>
      runTest(shouldRepairDeletedGitPackageDependenciesWhen));
  });
});
