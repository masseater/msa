import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import commandRunner from "../src/core/package-manager/command-runner.ts";
import gitRemote from "../src/core/package-manager/git-remote.ts";
import platform from "../src/core/platform/index.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
const { readEnv } = platform;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
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

const shouldRemoveANewlyCreatedCheckoutWhen = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const source = "git:github.com/user/repo";
  const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
  vi.spyOn(commandRunner, "runCommand").mockImplementation((...callArgs: unknown[]) =>
    effectRunPromise(
      Effect.gen(function* () {
        const [command, args] = callArgs as [string, string[]];
        if (command === "git" && args[0] === "clone") {
          yield* makeDirectory(targetDir);
          throw new Error("simulated git clone failure");
        }
      }),
    ),
  );

  yield* awaited(
    expect(packageManager.operations.install.install(source)).rejects.toThrow(
      "simulated git clone failure",
    ),
  );

  expect(yield* pathExists(targetDir)).toBe(false);
});

const shouldRemoveANewlyClonedCheckoutWhen = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const source = "git:github.com/user/repo";
  const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
  vi.spyOn(commandRunner, "runCommand").mockImplementation((...callArgs: unknown[]) =>
    effectRunPromise(
      Effect.gen(function* () {
        const [command, args] = callArgs as [string, string[]];
        if (command === "git" && args[0] === "clone") {
          yield* makeDirectory(targetDir);
          yield* writeJsonFile(joinPath(targetDir, "package.json"), {
            name: "repo",
            version: "1.0.0",
          });
          return;
        }
        if (command === "npm") {
          throw new Error("simulated dependency install failure");
        }
      }),
    ),
  );

  yield* awaited(
    expect(packageManager.operations.install.install(source)).rejects.toThrow(
      "simulated dependency install failure",
    ),
  );

  expect(yield* pathExists(targetDir)).toBe(false);
});

const shouldReconcileAnExistingGitCheckoutToSetup = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const source = "git:github.com/user/repo@v2";
    const targetDir = joinPath(agentDir, "git", "github.com", "user", "repo");
    return { effectRunPromise, source, targetDir };
  });

const shouldReconcileAnExistingGitCheckoutTo = Effect.gen(function* () {
  const { effectRunPromise, source, targetDir } =
    yield* shouldReconcileAnExistingGitCheckoutToSetup();
  yield* makeDirectory(targetDir);
  yield* writeTextFile(
    joinPath(targetDir, "package.json"),
    yield* toJsonText({ name: "repo", version: "1.0.0" }),
  );
  vi.spyOn(commandRunner, "runCommandCapture").mockImplementation((_command, args) =>
    effectRunPromise(
      Effect.gen(function* () {
        if (args[0] === "rev-parse" && args[1] === "HEAD") {
          return yield* awaited("old-head");
        }
        if (args[0] === "rev-parse" && args[1] === "FETCH_HEAD^{commit}") {
          return yield* awaited("new-head");
        }
        throw new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`);
      }),
    ),
  );
  const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

  yield* awaited(packageManager.operations.install.install(source));

  expect(runCommandSpy).toHaveBeenCalledWith("git", ["fetch", "origin", "v2"], {
    cwd: targetDir,
  });
  expect(runCommandSpy).toHaveBeenCalledWith("git", ["reset", "--hard", "FETCH_HEAD^{commit}"], {
    cwd: targetDir,
  });
  expect(runCommandSpy).toHaveBeenCalledWith("git", ["clean", "-fdx"], { cwd: targetDir });
  expect(runCommandSpy).toHaveBeenCalledWith(
    "npm",
    ["install", "--omit=dev", "--legacy-peer-deps"],
    {
      cwd: targetDir,
    },
  );
});

const shouldReconcileAnExistingGitCheckoutTo2 = Effect.gen(function* () {
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
  yield* makeDirectory(targetDir);
  vi.spyOn(gitRemote, "getLocalGitUpdateTarget").mockResolvedValue({
    fetchArgs,
    head: "new-head",
    ref: "origin/HEAD",
  });
  vi.spyOn(commandRunner, "runCommandCapture").mockImplementation((_command, args) =>
    effectRunPromise(
      Effect.gen(function* () {
        if (args[0] === "rev-parse" && args[1] === "HEAD") {
          return yield* awaited("old-head");
        }
        if (args[0] === "rev-parse" && args[1] === "origin/HEAD^{commit}") {
          return yield* awaited("new-head");
        }
        throw new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`);
      }),
    ),
  );
  const runCommandSpy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue(undefined);

  yield* awaited(packageManager.operations.install.install(source));

  expect(runCommandSpy).toHaveBeenCalledWith("git", fetchArgs, { cwd: targetDir });
  expect(runCommandSpy).toHaveBeenCalledWith("git", ["reset", "--hard", "origin/HEAD^{commit}"], {
    cwd: targetDir,
  });
  expect(runCommandSpy).toHaveBeenCalledWith("git", ["clean", "-fdx"], { cwd: targetDir });
});

const shouldPreferThePackageManagerAfterA = () => {
  settingsManager = SettingsManager.inMemory({
    npmCommand: ["npm", "exec", "--", "pnpm"],
  });
  packageManager = new DefaultPackageManager({
    agentDir,
    cwd: tempDir,
    settingsManager,
  });
  expect(packageManager.npm.tool.getPackageManagerName()).toBe("pnpm");
  expect(packageManager.npm.tool.getGitDependencyInstallArgs()).toEqual([
    "install",
    "--prod",
    "--config.auto-install-peers=false",
    "--config.strict-peer-dependencies=false",
    "--config.strict-dep-builds=false",
  ]);
};

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
    it("should remove a newly created checkout when git clone fails", () =>
      runTest(shouldRemoveANewlyCreatedCheckoutWhen));

    it("should remove a newly cloned checkout when dependency installation fails", () =>
      runTest(shouldRemoveANewlyClonedCheckoutWhen));

    it("should reconcile an existing git checkout to a pinned ref during install", () =>
      runTest(shouldReconcileAnExistingGitCheckoutTo));

    it("should reconcile an existing git checkout to its update target when installing without a ref", () =>
      runTest(shouldReconcileAnExistingGitCheckoutTo2));

    it(
      "should prefer the package manager after a separator over the outer executable",
      shouldPreferThePackageManagerAfterA,
    );
  });
});
