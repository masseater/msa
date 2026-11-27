import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { packagePaths } = packageManagerSupport;

const { fileMode, joinPath, makeDirectory, relativePath, runTest, writeTextFile } = testing;

const shouldPlaceTemporaryNpmPackagesUnderThe = Effect.gen(function* () {
  const source = fixture.packageManager.sources.parseSource("npm:left-pad");
  if (source.type !== "npm") {
    throw new Error("Expected npm source");
  }

  const installPath = yield* Effect.promise(() =>
    fixture.packageManager.npm.paths.getNpmInstallPath(source, "temporary"),
  );
  const tempRoot = joinPath(fixture.agentDir, "tmp", "extensions");
  yield* Effect.promise(() =>
    fixture.packageManager.npm.paths.ensureNpmProject(
      fixture.packageManager.npm.paths.getNpmInstallRoot("temporary", true),
      true,
    ),
  );

  expect(packagePaths.pathEndsWith(installPath, "node_modules/left-pad")).toBe(true);
  expect(relativePath(tempRoot, installPath).startsWith("..")).toBe(false);
  expect(installPath.startsWith(joinPath(fixture.tempDir, "msa-extensions"))).toBe(false);
  if (process.platform !== "win32") {
    expect((yield* fileMode(tempRoot)) & 0o777).toBe(0o700);
  }
});

const shouldStoreGlobalLocalPackagesRelativeTo = Effect.gen(function* () {
  const pkgDir = joinPath(fixture.tempDir, "packages", "local-global-pkg");
  yield* makeDirectory(joinPath(pkgDir, "extensions"));
  yield* writeTextFile(joinPath(pkgDir, "extensions", "index.ts"), "export default function() {}");

  const added = fixture.packageManager.configured.addSourceToSettings(
    "./packages/local-global-pkg",
  );
  expect(added).toBe(true);

  const settings = fixture.settingsManager.getGlobalSettings();
  const rel = relativePath(fixture.agentDir, pkgDir);
  const expected = rel.startsWith(".") ? rel : `./${rel}`;
  expect(settings.packages?.[0]).toBe(expected);
});

const shouldStoreProjectLocalPackagesRelativeTo = Effect.gen(function* () {
  const projectPkgDir = joinPath(fixture.tempDir, "project-local-pkg");
  yield* makeDirectory(joinPath(projectPkgDir, "extensions"));
  yield* writeTextFile(
    joinPath(projectPkgDir, "extensions", "index.ts"),
    "export default function() {}",
  );

  const added = fixture.packageManager.configured.addSourceToSettings("./project-local-pkg", {
    local: true,
  });
  expect(added).toBe(true);

  const settings = fixture.settingsManager.getProjectSettings();
  const rel = relativePath(joinPath(fixture.tempDir, ".msa"), projectPkgDir);
  const expected = rel.startsWith(".") ? rel : `./${rel}`;
  expect(settings.packages?.[0]).toBe(expected);
});

const shouldRemoveLocalPackageEntriesUsingEquivalent = Effect.gen(function* () {
  const pkgDir = joinPath(fixture.tempDir, "remove-local-pkg");
  yield* makeDirectory(joinPath(pkgDir, "extensions"));
  yield* writeTextFile(joinPath(pkgDir, "extensions", "index.ts"), "export default function() {}");

  fixture.packageManager.configured.addSourceToSettings("./remove-local-pkg");
  const removed = fixture.packageManager.configured.removeSourceFromSettings(`${pkgDir}/`);
  expect(removed).toBe(true);
  expect(fixture.settingsManager.getGlobalSettings().packages ?? []).toHaveLength(0);
});

const shouldReturnFalseWhenAddingTheSame = () => {
  const first = fixture.packageManager.configured.addSourceToSettings(
    "git:github.com/user/repo@v1",
  );
  expect(first).toBe(true);

  const second = fixture.packageManager.configured.addSourceToSettings(
    "git:github.com/user/repo@v1",
  );
  expect(second).toBe(false);
  expect(fixture.settingsManager.getGlobalSettings().packages).toEqual([
    "git:github.com/user/repo@v1",
  ]);
};

const shouldUpdateTheRefWhenAddingThe = () => {
  fixture.packageManager.configured.addSourceToSettings("git:github.com/user/repo@v1");

  const updated = fixture.packageManager.configured.addSourceToSettings(
    "git:github.com/user/repo@v2",
  );
  expect(updated).toBe(true);
  expect(fixture.settingsManager.getGlobalSettings().packages).toEqual([
    "git:github.com/user/repo@v2",
  ]);
};

const shouldPreservePackageFiltersWhenReplacingA = () => {
  fixture.settingsManager.resources.setPackages([
    {
      extensions: ["extensions/main.ts"],
      prompts: ["prompts/review.md"],
      skills: [],
      source: "git:github.com/user/repo@v1",
      themes: ["themes/dark.json"],
    },
  ]);

  const updated = fixture.packageManager.configured.addSourceToSettings(
    "git:github.com/user/repo@v2",
  );
  expect(updated).toBe(true);
  expect(fixture.settingsManager.getGlobalSettings().packages).toEqual([
    {
      extensions: ["extensions/main.ts"],
      prompts: ["prompts/review.md"],
      skills: [],
      source: "git:github.com/user/repo@v2",
      themes: ["themes/dark.json"],
    },
  ]);
};

describe("DefaultPackageManager", () => {
  describe("temporary install paths", () => {
    it("should place temporary npm packages under the agent temp extension folder", () =>
      runTest(shouldPlaceTemporaryNpmPackagesUnderThe));
  });
});

describe("DefaultPackageManager", () => {
  describe("settings source normalization", () => {
    it("should store global local packages relative to agent settings base", () =>
      runTest(shouldStoreGlobalLocalPackagesRelativeTo));

    it("should store project local packages relative to .msa settings base", () =>
      runTest(shouldStoreProjectLocalPackagesRelativeTo));

    it("should remove local package entries using equivalent path forms", () =>
      runTest(shouldRemoveLocalPackageEntriesUsingEquivalent));

    it(
      "should return false when adding the same git source with the same ref",
      shouldReturnFalseWhenAddingTheSame,
    );

    it(
      "should update the ref when adding the same git source with a different ref",
      shouldUpdateTheRefWhenAddingThe,
    );

    it(
      "should preserve package filters when replacing a package source ref",
      shouldPreservePackageFiltersWhenReplacingA,
    );
  });
});
