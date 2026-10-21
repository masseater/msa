import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import commandRunner from "../src/core/package-manager/command-runner.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";
import parsedSource from "./parsed-source.ts";

const { asGit } = parsedSource;
const { packagePaths } = packageManagerSupport;
const { usePackageManagerFixture } = packageManagerFixture;
const { awaited, joinPath, makeDirectory, runTest, toJsonText, writeTextFile } = testing;

const fixture = usePackageManagerFixture();

const shouldSkipInstallingMissingPackageSourcesWhen = Effect.gen(function* () {
  vi.stubEnv("MSA_OFFLINE", "1");
  fixture.settingsManager.resources.setProjectPackages([
    "npm:missing-package",
    "git:github.com/example/missing-repo",
  ]);

  const installParsedSourceSpy = vi.spyOn(
    fixture.packageManager.resources.packages,
    "installParsedSource",
  );

  const result = yield* awaited(fixture.packageManager.resolution.resolve());
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
  const parsedGitSource = asGit(fixture.packageManager.sources.parseSource(gitSource));
  const installedPath = fixture.packageManager.git.paths.getGitInstallPath(
    parsedGitSource,
    "temporary",
  ) as string;

  yield* makeDirectory(joinPath(installedPath, "extensions"));
  yield* writeTextFile(
    joinPath(installedPath, "extensions", "index.ts"),
    "export default function() {};",
  );

  const refreshTemporaryGitSourceSpy = vi.spyOn(
    fixture.packageManager.git.installs,
    "refreshTemporaryGitSource",
  );

  const result = yield* awaited(
    fixture.packageManager.resolution.resolveExtensionSources([gitSource], { temporary: true }),
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
  const oldParsed = fixture.packageManager.sources.parseSource(oldSource);
  const newParsed = fixture.packageManager.sources.parseSource(newSource);
  if (oldParsed.type !== "git" || newParsed.type !== "git") {
    throw new Error("Expected git sources");
  }

  const oldPath = fixture.packageManager.git.paths.getGitInstallPath(oldParsed, "temporary");
  yield* makeDirectory(joinPath(oldPath, "extensions"));
  yield* writeTextFile(joinPath(oldPath, "extensions", "old.ts"), "export default function() {};");

  const installParsedSourceSpy = vi
    .spyOn(fixture.packageManager.resources.packages, "installParsedSource")
    .mockImplementation(() =>
      effectRunPromise(
        Effect.gen(function* () {
          const newPath = fixture.packageManager.git.paths.getGitInstallPath(
            newParsed,
            "temporary",
          );
          yield* makeDirectory(joinPath(newPath, "extensions"));
          yield* writeTextFile(
            joinPath(newPath, "extensions", "new.ts"),
            "export default function() {};",
          );
        }),
      ),
    );

  const result = yield* awaited(
    fixture.packageManager.resolution.resolveExtensionSources([newSource], { temporary: true }),
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
  const installedPath = joinPath(fixture.tempDir, ".msa", "npm", "node_modules", "example");
  yield* makeDirectory(joinPath(installedPath, "extensions"));
  yield* writeTextFile(
    joinPath(installedPath, "package.json"),
    yield* toJsonText({ name: "example", version: "1.0.0" }),
  );
  yield* writeTextFile(
    joinPath(installedPath, "extensions", "index.ts"),
    "export default function() {};",
  );
  fixture.settingsManager.resources.setProjectPackages(["npm:example@^1.0.0"]);

  const runCommandCaptureSpy = vi.spyOn(commandRunner, "runCommandCapture");

  const result = yield* awaited(fixture.packageManager.resolution.resolve());
  expect(
    result.extensions.some(
      (r) => packagePaths.pathEndsWith(r.path, "extensions/index.ts") && r.enabled,
    ),
  ).toBe(true);
  expect(runCommandCaptureSpy).not.toHaveBeenCalled();
});

const shouldReinstallPinnedNpmPackagesWhenInstalled = Effect.gen(function* () {
  const installedPath = joinPath(fixture.tempDir, ".msa", "npm", "node_modules", "example");
  yield* makeDirectory(installedPath);
  yield* writeTextFile(
    joinPath(installedPath, "package.json"),
    yield* toJsonText({ name: "example", version: "1.0.0" }),
  );
  fixture.settingsManager.resources.setProjectPackages(["npm:example@2.0.0"]);

  const installParsedSourceSpy = vi
    .spyOn(fixture.packageManager.resources.packages, "installParsedSource")
    .mockResolvedValue(undefined);

  yield* awaited(fixture.packageManager.resolution.resolve());
  expect(installParsedSourceSpy).toHaveBeenCalledTimes(1);
});

describe("DefaultPackageManager resolve with installed and offline sources", () => {
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
});
