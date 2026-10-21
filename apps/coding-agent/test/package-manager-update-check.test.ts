import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import gitRemote from "../src/core/package-manager/git-remote.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import parsedSource from "./parsed-source.ts";

const { asGit } = parsedSource;
const { usePackageManagerFixture } = packageManagerFixture;
const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const fixture = usePackageManagerFixture();

const shouldNotCheckPackageUpdatesWhenOffline = Effect.gen(function* () {
  vi.stubEnv("MSA_OFFLINE", "1");
  const runCommandCaptureSpy = vi.spyOn(commandRunner, "runCommandCapture");

  const updates = yield* awaited(
    fixture.packageManager.operations.updateCheck.checkForAvailableUpdates(),
  );
  expect(updates).toEqual([]);
  expect(runCommandCaptureSpy).not.toHaveBeenCalled();
});

const shouldReportUpdatesForInstalledUnpinnedNpm = Effect.gen(function* () {
  const installedPath = joinPath(fixture.tempDir, ".msa", "npm", "node_modules", "example");
  yield* makeDirectory(installedPath);
  yield* writeTextFile(
    joinPath(installedPath, "package.json"),
    yield* toJsonText({ name: "example", version: "1.0.0" }),
  );
  fixture.settingsManager.resources.setProjectPackages(["npm:example"]);

  vi.spyOn(commandRunner, "runCommandCapture").mockResolvedValue('"1.2.3"');

  const updates = yield* awaited(
    fixture.packageManager.operations.updateCheck.checkForAvailableUpdates(),
  );
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
  const installedPath = joinPath(fixture.tempDir, ".msa", "npm", "node_modules", "example");
  yield* makeDirectory(installedPath);
  yield* writeTextFile(
    joinPath(installedPath, "package.json"),
    yield* toJsonText({ name: "example", version: "2.0.0" }),
  );
  fixture.settingsManager.resources.setProjectPackages(["npm:example"]);

  vi.spyOn(commandRunner, "runCommandCapture").mockResolvedValue('"1.9.0"');

  const updates = yield* awaited(
    fixture.packageManager.operations.updateCheck.checkForAvailableUpdates(),
  );
  expect(updates).toEqual([]);
});

const shouldSkipPinnedPackagesWhenCheckingFor = Effect.gen(function* () {
  const installedNpmPath = joinPath(fixture.tempDir, ".msa", "npm", "node_modules", "example");
  yield* makeDirectory(installedNpmPath);
  yield* writeTextFile(
    joinPath(installedNpmPath, "package.json"),
    yield* toJsonText({ name: "example", version: "1.0.0" }),
  );
  const parsedGitSource = asGit(
    fixture.packageManager.sources.parseSource("git:github.com/example/repo@v1"),
  );
  const installedGitPath = fixture.packageManager.git.paths.getGitInstallPath(
    parsedGitSource,
    "project",
  ) as string;
  yield* makeDirectory(installedGitPath);

  fixture.settingsManager.resources.setProjectPackages([
    "npm:example@1.0.0",
    "git:github.com/example/repo@v1",
  ]);

  const runCommandCaptureSpy = vi.spyOn(commandRunner, "runCommandCapture");
  const gitUpdateSpy = vi.spyOn(gitRemote, "gitHasAvailableUpdate");

  const updates = yield* awaited(
    fixture.packageManager.operations.updateCheck.checkForAvailableUpdates(),
  );
  expect(updates).toEqual([]);
  expect(runCommandCaptureSpy).not.toHaveBeenCalled();
  expect(gitUpdateSpy).not.toHaveBeenCalled();
});

describe("DefaultPackageManager update check", () => {
  it("should not check package updates when offline", () =>
    runTest(shouldNotCheckPackageUpdatesWhenOffline));

  it("should report updates for installed unpinned npm packages", () =>
    runTest(shouldReportUpdatesForInstalledUnpinnedNpm));

  it("should not report npm updates when the installed version is newer than the registry version", () =>
    runTest(shouldNotReportNpmUpdatesWhenThe));

  it("should skip pinned packages when checking for updates", () =>
    runTest(shouldSkipPinnedPackagesWhenCheckingFor));
});
