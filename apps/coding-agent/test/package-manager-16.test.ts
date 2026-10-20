import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import commandRunner from "../src/core/package-manager/command-runner.ts";
import gitRemote from "../src/core/package-manager/git-remote.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import packageManagerSupport from "./package-manager-support.ts";
import parsedSource from "./parsed-source.ts";

const { asGit } = parsedSource;
const { readEnv } = processEnv;

const { packagePaths } = packageManagerSupport;

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

const shouldSkipInstallingMissingPackageSourcesWhen = Effect.gen(function* () {
  vi.stubEnv("MSA_OFFLINE", "1");
  settingsManager.setProjectPackages([
    "npm:missing-package",
    "git:github.com/example/missing-repo",
  ]);

  const installParsedSourceSpy = vi.spyOn(packageManager.resources.packages, "installParsedSource");

  const result = yield* awaited(packageManager.resolution.resolve());
  const allResources = [
    ...result.extensions,
    ...result.skills,
    ...result.prompts,
    ...result.themes,
  ];
  expect(allResources.some((r) => r.metadata.origin === "package")).toBe(false);
  expect(installParsedSourceSpy).not.toHaveBeenCalled();
});

const shouldSkipRefreshingTemporaryGitSourcesWhen = Effect.gen(function* () {
  vi.stubEnv("MSA_OFFLINE", "1");
  const gitSource = "git:github.com/example/repo";
  const parsedGitSource = asGit(packageManager.sources.parseSource(gitSource));
  const installedPath = packageManager.git.paths.getGitInstallPath(
    parsedGitSource,
    "temporary",
  ) as string;

  yield* makeDirectory(joinPath(installedPath, "extensions"));
  yield* writeTextFile(
    joinPath(installedPath, "extensions", "index.ts"),
    "export default function() {};",
  );

  const refreshTemporaryGitSourceSpy = vi.spyOn(
    packageManager.git.installs,
    "refreshTemporaryGitSource",
  );

  const result = yield* awaited(
    packageManager.resolution.resolveExtensionSources([gitSource], { temporary: true }),
  );
  expect(
    result.extensions.some(
      (r) => packagePaths.pathEndsWith(r.path, "extensions/index.ts") && r.enabled,
    ),
  ).toBe(true);
  expect(refreshTemporaryGitSourceSpy).not.toHaveBeenCalled();
});

const shouldLoadANewCheckoutWhenA = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const oldSource = "git:github.com/example/repo@aaaaaaa";
  const newSource = "git:github.com/example/repo@bbbbbbb";
  const oldParsed = packageManager.sources.parseSource(oldSource);
  const newParsed = packageManager.sources.parseSource(newSource);
  if (oldParsed.type !== "git" || newParsed.type !== "git") {
    throw new Error("Expected git sources");
  }

  const oldPath = packageManager.git.paths.getGitInstallPath(oldParsed, "temporary");
  yield* makeDirectory(joinPath(oldPath, "extensions"));
  yield* writeTextFile(joinPath(oldPath, "extensions", "old.ts"), "export default function() {};");

  const installParsedSourceSpy = vi
    .spyOn(packageManager.resources.packages, "installParsedSource")
    .mockImplementation(() =>
      effectRunPromise(
        Effect.gen(function* () {
          const newPath = packageManager.git.paths.getGitInstallPath(newParsed, "temporary");
          yield* makeDirectory(joinPath(newPath, "extensions"));
          yield* writeTextFile(
            joinPath(newPath, "extensions", "new.ts"),
            "export default function() {};",
          );
        }),
      ),
    );

  const result = yield* awaited(
    packageManager.resolution.resolveExtensionSources([newSource], { temporary: true }),
  );
  expect(installParsedSourceSpy).toHaveBeenCalledTimes(1);
  expect(
    result.extensions.some(
      (r) => packagePaths.pathEndsWith(r.path, "extensions/new.ts") && r.enabled,
    ),
  ).toBe(true);
  expect(
    result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "extensions/old.ts")),
  ).toBe(false);
});

const shouldNotRunNpmViewDuringResolve = Effect.gen(function* () {
  vi.stubEnv("MSA_OFFLINE", "1");
  const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
  yield* makeDirectory(joinPath(installedPath, "extensions"));
  yield* writeTextFile(
    joinPath(installedPath, "package.json"),
    yield* toJsonText({ name: "example", version: "1.0.0" }),
  );
  yield* writeTextFile(
    joinPath(installedPath, "extensions", "index.ts"),
    "export default function() {};",
  );
  settingsManager.setProjectPackages(["npm:example@^1.0.0"]);

  const runCommandCaptureSpy = vi.spyOn(commandRunner, "runCommandCapture");

  const result = yield* awaited(packageManager.resolution.resolve());
  expect(
    result.extensions.some(
      (r) => packagePaths.pathEndsWith(r.path, "extensions/index.ts") && r.enabled,
    ),
  ).toBe(true);
  expect(runCommandCaptureSpy).not.toHaveBeenCalled();
});

const shouldReinstallPinnedNpmPackagesWhenInstalled = Effect.gen(function* () {
  const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
  yield* makeDirectory(installedPath);
  yield* writeTextFile(
    joinPath(installedPath, "package.json"),
    yield* toJsonText({ name: "example", version: "1.0.0" }),
  );
  settingsManager.setProjectPackages(["npm:example@2.0.0"]);

  const installParsedSourceSpy = vi
    .spyOn(packageManager.resources.packages, "installParsedSource")
    .mockResolvedValue(undefined);

  yield* awaited(packageManager.resolution.resolve());
  expect(installParsedSourceSpy).toHaveBeenCalledTimes(1);
});

const shouldNotCheckPackageUpdatesWhenOffline = Effect.gen(function* () {
  vi.stubEnv("MSA_OFFLINE", "1");
  const runCommandCaptureSpy = vi.spyOn(commandRunner, "runCommandCapture");

  const updates = yield* awaited(packageManager.operations.updateCheck.checkForAvailableUpdates());
  expect(updates).toEqual([]);
  expect(runCommandCaptureSpy).not.toHaveBeenCalled();
});

const shouldReportUpdatesForInstalledUnpinnedNpm = Effect.gen(function* () {
  const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
  yield* makeDirectory(installedPath);
  yield* writeTextFile(
    joinPath(installedPath, "package.json"),
    yield* toJsonText({ name: "example", version: "1.0.0" }),
  );
  settingsManager.setProjectPackages(["npm:example"]);

  vi.spyOn(commandRunner, "runCommandCapture").mockResolvedValue('"1.2.3"');

  const updates = yield* awaited(packageManager.operations.updateCheck.checkForAvailableUpdates());
  expect(updates).toEqual([
    {
      displayName: "example",
      scope: "project",
      source: "npm:example",
      type: "npm",
    },
  ]);
});

const shouldNotReportNpmUpdatesWhenThe = Effect.gen(function* () {
  const installedPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
  yield* makeDirectory(installedPath);
  yield* writeTextFile(
    joinPath(installedPath, "package.json"),
    yield* toJsonText({ name: "example", version: "2.0.0" }),
  );
  settingsManager.setProjectPackages(["npm:example"]);

  vi.spyOn(commandRunner, "runCommandCapture").mockResolvedValue('"1.9.0"');

  const updates = yield* awaited(packageManager.operations.updateCheck.checkForAvailableUpdates());
  expect(updates).toEqual([]);
});

const shouldSkipPinnedPackagesWhenCheckingFor = Effect.gen(function* () {
  const installedNpmPath = joinPath(tempDir, ".msa", "npm", "node_modules", "example");
  yield* makeDirectory(installedNpmPath);
  yield* writeTextFile(
    joinPath(installedNpmPath, "package.json"),
    yield* toJsonText({ name: "example", version: "1.0.0" }),
  );
  const parsedGitSource = asGit(
    packageManager.sources.parseSource("git:github.com/example/repo@v1"),
  );
  const installedGitPath = packageManager.git.paths.getGitInstallPath(
    parsedGitSource,
    "project",
  ) as string;
  yield* makeDirectory(installedGitPath);

  settingsManager.setProjectPackages(["npm:example@1.0.0", "git:github.com/example/repo@v1"]);

  const runCommandCaptureSpy = vi.spyOn(commandRunner, "runCommandCapture");
  const gitUpdateSpy = vi.spyOn(gitRemote, "gitHasAvailableUpdate");

  const updates = yield* awaited(packageManager.operations.updateCheck.checkForAvailableUpdates());
  expect(updates).toEqual([]);
  expect(runCommandCaptureSpy).not.toHaveBeenCalled();
  expect(gitUpdateSpy).not.toHaveBeenCalled();
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
    it("should skip installing missing package sources when offline", () =>
      runTest(shouldSkipInstallingMissingPackageSourcesWhen));

    it("should skip refreshing temporary git sources when offline", () =>
      runTest(shouldSkipRefreshingTemporaryGitSourcesWhen));

    it("should load a new checkout when a pinned temporary git source changes ref", () =>
      runTest(shouldLoadANewCheckoutWhenA));

    it("should not run npm view during resolve for installed unpinned packages", () =>
      runTest(shouldNotRunNpmViewDuringResolve));

    it("should reinstall pinned npm packages when installed version does not match", () =>
      runTest(shouldReinstallPinnedNpmPackagesWhenInstalled));

    it("should not check package updates when offline", () =>
      runTest(shouldNotCheckPackageUpdatesWhenOffline));

    it("should report updates for installed unpinned npm packages", () =>
      runTest(shouldReportUpdatesForInstalledUnpinnedNpm));

    it("should not report npm updates when the installed version is newer than the registry version", () =>
      runTest(shouldNotReportNpmUpdatesWhenThe));

    it("should skip pinned packages when checking for updates", () =>
      runTest(shouldSkipPinnedPackagesWhenCheckingFor));
  });
});
