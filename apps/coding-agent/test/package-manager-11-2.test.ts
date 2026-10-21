import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultPackageManager from "../src/core/default-package-manager.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import platform from "../src/core/platform/index.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import packageManagerSupport from "./package-manager-support.ts";
const { readEnv } = platform;

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

const shouldApplyUserFiltersOnTopOf = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "layered-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "foo.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "bar.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "baz.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["extensions", "!**/baz.ts"],
          },
          name: "layered-pkg",
        }),
      );

      settingsManager.resources.setPackages([
        {
          extensions: ["!**/bar.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(packageManager.resolution.resolve());

      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "foo.ts"))).toBe(true);

      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "bar.ts"))).toBe(true);

      expect(result.extensions.some((r) => packagePaths.pathEndsWith(r.path, "baz.ts"))).toBe(
        false,
      );
    }),
  );

const shouldExcludeExtensionsFromPackageWithPattern = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "pattern-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "foo.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "bar.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "baz.ts"),
        "export default function() {}",
      );

      settingsManager.resources.setPackages([
        {
          extensions: ["!**/baz.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "foo.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "bar.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "baz.ts"))).toBe(true);
    }),
  );

const shouldFilterThemesFromPackage = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "theme-pkg");
      yield* makeDirectory(joinPath(pkgDir, "themes"));
      yield* writeTextFile(joinPath(pkgDir, "themes", "nice.json"), "{}");
      yield* writeTextFile(joinPath(pkgDir, "themes", "ugly.json"), "{}");

      settingsManager.resources.setPackages([
        {
          extensions: [],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: ["!ugly.json"],
        },
      ]);

      const result = yield* awaited(packageManager.resolution.resolve());
      expect(result.themes.some((r) => packagePaths.isEnabled(r, "nice.json"))).toBe(true);
      expect(result.themes.some((r) => packagePaths.isDisabled(r, "ugly.json"))).toBe(true);
    }),
  );

const shouldCombineIncludeAndExcludePatterns = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "combo-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "alpha.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "beta.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "gamma.ts"),
        "export default function() {}",
      );

      settingsManager.resources.setPackages([
        {
          extensions: ["**/alpha.ts", "**/beta.ts", "!**/beta.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "beta.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "gamma.ts"))).toBe(true);
    }),
  );

const beforeEachHook2 = () =>
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

const afterEachHook2 = () => {
  vi.stubEnv("MSA_OFFLINE", previousOfflineEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return runTest(removePath(tempDir));
};

describe("DefaultPackageManager", () => {
  beforeEach(beforeEachHook2);

  afterEach(afterEachHook2);

  describe("pattern filtering in package filters", () => {
    it(
      "should apply user filters on top of manifest filters (not replace)",
      shouldApplyUserFiltersOnTopOf,
    );

    it(
      "should exclude extensions from package with ! pattern",
      shouldExcludeExtensionsFromPackageWithPattern,
    );

    it("should filter themes from package", shouldFilterThemesFromPackage);

    it("should combine include and exclude patterns", shouldCombineIncludeAndExcludePatterns);
  });
});
