import testing from "@msa/testing";
import { Deferred, Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import commandRunner from "../src/core/package-manager/command-runner.ts";
import platform from "../src/core/platform/index.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
const { readEnv } = platform;

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

const installedUserPath = (source: string) =>
  Effect.promise(() => packageManager.configured.getInstalledPath(source, "user"));

let previousOfflineEnv: string | undefined;

const shouldMigrateLegacyUserNpmInstallsInto = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const legacyRoot = joinPath(tempDir, "legacy-global", "node_modules");
  const legacyPath = joinPath(legacyRoot, "legacy-pkg");
  const managedPath = joinPath(agentDir, "npm", "node_modules", "legacy-pkg");
  yield* makeDirectory(legacyPath);
  yield* writeTextFile(
    joinPath(legacyPath, "package.json"),
    yield* toJsonText({ name: "legacy-pkg", version: "1.0.0" }),
  );
  settingsManager.resources.setPackages(["npm:legacy-pkg"]);

  vi.spyOn(packageManager.npm.tool, "getGlobalNpmRoot").mockReturnValue(legacyRoot);
  const runCommandCaptureSpy = vi
    .spyOn(commandRunner, "runCommandCapture")
    .mockResolvedValue('"1.0.0"');
  const runCommandSpy = vi
    .spyOn(commandRunner, "runCommand")
    .mockImplementation((...callArgs: unknown[]) =>
      effectRunPromise(
        Effect.gen(function* () {
          const [command, args] = callArgs as [string, string[]];
          expect(command).toBe("npm");
          expect(args).toEqual([
            "install",
            "legacy-pkg@latest",
            "--prefix",
            joinPath(agentDir, "npm"),
            "--legacy-peer-deps",
          ]);
          yield* makeDirectory(managedPath);
          yield* writeJsonFile(joinPath(managedPath, "package.json"), {
            name: "legacy-pkg",
            version: "1.0.0",
          });
        }),
      ),
    );

  expect(yield* installedUserPath("npm:legacy-pkg")).toBe(legacyPath);

  yield* awaited(packageManager.operations.updates.update("npm:legacy-pkg"));

  expect(runCommandCaptureSpy).not.toHaveBeenCalled();
  expect(runCommandSpy).toHaveBeenCalledTimes(1);
  expect(yield* installedUserPath("npm:legacy-pkg")).toBe(managedPath);
});

const seedInstalledNpmPackages = Effect.gen(function* () {
  const roots = {
    project: joinPath(tempDir, ".msa", "npm", "node_modules"),
    user: joinPath(agentDir, "npm", "node_modules"),
  };
  for (const [scope, name] of [
    ["user", "user-old"],
    ["user", "user-current"],
    ["user", "user-unknown"],
    ["project", "project-old"],
    ["project", "project-current"],
  ] as const) {
    const installPath = joinPath(roots[scope], name);
    yield* makeDirectory(installPath);
    yield* writeTextFile(
      joinPath(installPath, "package.json"),
      yield* toJsonText({ name, version: "1.0.0" }),
    );
  }
  settingsManager.resources.setPackages([
    "npm:user-old",
    "npm:user-current",
    "npm:user-unknown",
    "npm:user-pinned@1.0.0",
    "git:github.com/example/user-repo-a",
    "git:github.com/example/user-repo-b",
    "git:github.com/example/user-repo-pinned@v1",
  ]);
  settingsManager.resources.setProjectPackages([
    "npm:project-old",
    "npm:project-current",
    "npm:project-missing",
    "git:github.com/example/project-repo-a",
  ]);
});

const latestVersions: Record<string, string> = {
  "project-current": '"1.0.0"',
  "project-old": '"2.0.0"',
  "user-current": '"1.0.0"',
  "user-old": '"2.0.0"',
};

const lookUpLatestVersion = (...callArgs: unknown[]) => {
  const [_command, args] = callArgs as [string, string[]];
  if (args[0] !== "view")
    return Promise.reject(new Error(`Unexpected runCommandCapture args: ${args.join(" ")}`));
  if (args[1] === "user-unknown") return Promise.reject(new Error("registry unavailable"));
  const version = latestVersions[args[1] ?? ""];
  if (version === undefined)
    return Promise.reject(new Error(`Unexpected package lookup: ${args[1]}`));
  return Promise.resolve(version);
};

const concurrencyProbe = () => {
  const counts = { active: 0, max: 0 };
  const overlapped = Deferred.makeUnsafe<void>();
  const run = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        counts.active += 1;
        counts.max = Math.max(counts.max, counts.active);
        if (counts.active > 1) yield* Deferred.succeed(overlapped, undefined);
        yield* Effect.race(Deferred.await(overlapped), Effect.sleep(1000));
        counts.active -= 1;
      }),
    );
  return { counts, run };
};

const npmInstallArgs = (packages: string[], prefix: string) => [
  "install",
  ...packages.map((name) => `${name}@latest`),
  "--prefix",
  prefix,
  "--legacy-peer-deps",
];

const shouldBatchNpmUpdatesPerScopeAnd = Effect.gen(function* () {
  yield* seedInstalledNpmPackages;
  const runCommandCaptureSpy = vi
    .spyOn(commandRunner, "runCommandCapture")
    .mockImplementation(lookUpLatestVersion);
  const npm = concurrencyProbe();
  const runCommandSpy = vi
    .spyOn(commandRunner, "runCommand")
    .mockImplementation((...callArgs: unknown[]) => {
      const [command, args] = callArgs as [string, string[]];
      if (command !== "npm")
        throw new Error(`Unexpected runCommand call: ${command} ${args.join(" ")}`);
      return npm.run();
    });
  const git = concurrencyProbe();
  const updateGitSpy = vi
    .spyOn(packageManager.git.installs, "updateGit")
    .mockImplementation(git.run);

  yield* awaited(packageManager.operations.updates.update());

  expect(runCommandCaptureSpy).toHaveBeenCalledTimes(5);
  expect(runCommandSpy).toHaveBeenCalledTimes(2);
  expect(runCommandSpy).toHaveBeenCalledWith(
    "npm",
    npmInstallArgs(["user-old", "user-unknown"], joinPath(agentDir, "npm")),
    undefined,
  );
  expect(runCommandSpy).toHaveBeenCalledWith(
    "npm",
    npmInstallArgs(["project-old", "project-missing"], joinPath(tempDir, ".msa", "npm")),
    undefined,
  );
  expect(updateGitSpy).toHaveBeenCalledTimes(4);
  expect(npm.counts.max).toBeGreaterThan(1);
  expect(git.counts.max).toBeGreaterThan(1);
});

const shouldSuggestNpmSourcePrefixesForUpdate = Effect.gen(function* () {
  settingsManager.resources.setProjectPackages(["npm:example"]);

  yield* awaited(
    expect(packageManager.operations.updates.update("example")).rejects.toThrow(
      "No matching package found for example. Did you mean npm:example?",
    ),
  );
});

const shouldSuggestGitSourcePrefixesForUpdate = Effect.gen(function* () {
  settingsManager.resources.setProjectPackages(["git:github.com/example/repo"]);

  yield* awaited(
    expect(packageManager.operations.updates.update("github.com/example/repo")).rejects.toThrow(
      "No matching package found for github.com/example/repo. Did you mean git:github.com/example/repo?",
    ),
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

  describe("offline mode and network timeouts", () => {
    it("should migrate legacy user npm installs into the managed npm root during update", () =>
      runTest(shouldMigrateLegacyUserNpmInstallsInto));

    it("should batch npm updates per scope and run git updates in parallel while skipping pinned npm and current packages", () =>
      runTest(shouldBatchNpmUpdatesPerScopeAnd));

    it("should suggest npm source prefixes for update lookups", () =>
      runTest(shouldSuggestNpmSourcePrefixesForUpdate));

    it("should suggest git source prefixes for update lookups", () =>
      runTest(shouldSuggestGitSourcePrefixesForUpdate));
  });
});
