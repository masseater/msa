import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import processEnv from "../src/core/process-env.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import packageManagerSupport from "./package-manager-support.ts";
const { readEnv } = processEnv;

const { packagePaths } = packageManagerSupport;

const {
  fileMode,
  joinPath,
  makeDirectory,
  makeTempDir,
  relativePath,
  removePath,
  runTest,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let settingsManager: settingsManagerTypes.SettingsManager;

let packageManager: packageManagerTypes.DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldPlaceTemporaryNpmPackagesUnderThe = Effect.gen(function* () {
  const source = packageManager.sources.parseSource("npm:left-pad");
  if (source.type !== "npm") {
    throw new Error("Expected npm source");
  }

  const installPath = packageManager.npm.paths.getNpmInstallPath(source, "temporary");
  const tempRoot = joinPath(agentDir, "tmp", "extensions");

  expect(packagePaths.pathEndsWith(installPath, "node_modules/left-pad")).toBe(true);
  expect(relativePath(tempRoot, installPath).startsWith("..")).toBe(false);
  expect(installPath.startsWith(joinPath(tempDir, "msa-extensions"))).toBe(false);
  if (process.platform !== "win32") {
    expect((yield* fileMode(tempRoot)) & 0o777).toBe(0o700);
  }
});

const shouldStoreGlobalLocalPackagesRelativeTo = Effect.gen(function* () {
  const pkgDir = joinPath(tempDir, "packages", "local-global-pkg");
  yield* makeDirectory(joinPath(pkgDir, "extensions"));
  yield* writeTextFile(joinPath(pkgDir, "extensions", "index.ts"), "export default function() {}");

  const added = packageManager.configured.addSourceToSettings("./packages/local-global-pkg");
  expect(added).toBe(true);

  const settings = settingsManager.getGlobalSettings();
  const rel = relativePath(agentDir, pkgDir);
  const expected = rel.startsWith(".") ? rel : `./${rel}`;
  expect(settings.packages?.[0]).toBe(expected);
});

const shouldStoreProjectLocalPackagesRelativeTo = Effect.gen(function* () {
  const projectPkgDir = joinPath(tempDir, "project-local-pkg");
  yield* makeDirectory(joinPath(projectPkgDir, "extensions"));
  yield* writeTextFile(
    joinPath(projectPkgDir, "extensions", "index.ts"),
    "export default function() {}",
  );

  const added = packageManager.configured.addSourceToSettings("./project-local-pkg", {
    local: true,
  });
  expect(added).toBe(true);

  const settings = settingsManager.getProjectSettings();
  const rel = relativePath(joinPath(tempDir, ".msa"), projectPkgDir);
  const expected = rel.startsWith(".") ? rel : `./${rel}`;
  expect(settings.packages?.[0]).toBe(expected);
});

const shouldRemoveLocalPackageEntriesUsingEquivalent = Effect.gen(function* () {
  const pkgDir = joinPath(tempDir, "remove-local-pkg");
  yield* makeDirectory(joinPath(pkgDir, "extensions"));
  yield* writeTextFile(joinPath(pkgDir, "extensions", "index.ts"), "export default function() {}");

  packageManager.configured.addSourceToSettings("./remove-local-pkg");
  const removed = packageManager.configured.removeSourceFromSettings(`${pkgDir}/`);
  expect(removed).toBe(true);
  expect(settingsManager.getGlobalSettings().packages ?? []).toHaveLength(0);
});

const shouldReturnFalseWhenAddingTheSame = () => {
  const first = packageManager.configured.addSourceToSettings("git:github.com/user/repo@v1");
  expect(first).toBe(true);

  const second = packageManager.configured.addSourceToSettings("git:github.com/user/repo@v1");
  expect(second).toBe(false);
  expect(settingsManager.getGlobalSettings().packages).toEqual(["git:github.com/user/repo@v1"]);
};

const shouldUpdateTheRefWhenAddingThe = () => {
  packageManager.configured.addSourceToSettings("git:github.com/user/repo@v1");

  const updated = packageManager.configured.addSourceToSettings("git:github.com/user/repo@v2");
  expect(updated).toBe(true);
  expect(settingsManager.getGlobalSettings().packages).toEqual(["git:github.com/user/repo@v2"]);
};

const shouldPreservePackageFiltersWhenReplacingA = () => {
  settingsManager.resources.setPackages([
    {
      extensions: ["extensions/main.ts"],
      prompts: ["prompts/review.md"],
      skills: [],
      source: "git:github.com/user/repo@v1",
      themes: ["themes/dark.json"],
    },
  ]);

  const updated = packageManager.configured.addSourceToSettings("git:github.com/user/repo@v2");
  expect(updated).toBe(true);
  expect(settingsManager.getGlobalSettings().packages).toEqual([
    {
      extensions: ["extensions/main.ts"],
      prompts: ["prompts/review.md"],
      skills: [],
      source: "git:github.com/user/repo@v2",
      themes: ["themes/dark.json"],
    },
  ]);
};

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
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
    }),
  );

const afterEachHook = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("temporary install paths", () => {
    it("should place temporary npm packages under the agent temp extension folder", () =>
      runTest(shouldPlaceTemporaryNpmPackagesUnderThe));
  });
});

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

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
