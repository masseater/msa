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

const shouldForceIncludeExtensionsWithPatternAfter = () =>
  runTest(
    Effect.gen(function* () {
      const extDir = joinPath(agentDir, "extensions");
      yield* makeDirectory(extDir);
      yield* writeTextFile(joinPath(extDir, "keep.ts"), "export default function() {}");
      yield* writeTextFile(joinPath(extDir, "excluded.ts"), "export default function() {}");
      yield* writeTextFile(joinPath(extDir, "force-back.ts"), "export default function() {}");

      settingsManager.resources.setExtensionPaths([
        "extensions",
        "!extensions/*.ts",
        "+extensions/force-back.ts",
      ]);

      const result = yield* awaited(packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "keep.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "excluded.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "force-back.ts"))).toBe(true);
    }),
  );

const shouldForceIncludeOverridesExcludeInPackage = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "force-pkg");
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
          extensions: ["!**/*.ts", "+extensions/beta.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "beta.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "gamma.ts"))).toBe(true);
    }),
  );

const shouldForceIncludeMultipleResources = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "multi-force-pkg");
      yield* makeDirectory(joinPath(pkgDir, "skills/skill-a"));
      yield* makeDirectory(joinPath(pkgDir, "skills/skill-b"));
      yield* makeDirectory(joinPath(pkgDir, "skills/skill-c"));
      yield* writeTextFile(
        joinPath(pkgDir, "skills/skill-a", "SKILL.md"),
        "---\nname: skill-a\ndescription: A\n---\nContent",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "skills/skill-b", "SKILL.md"),
        "---\nname: skill-b\ndescription: B\n---\nContent",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "skills/skill-c", "SKILL.md"),
        "---\nname: skill-c\ndescription: C\n---\nContent",
      );

      settingsManager.resources.setPackages([
        {
          extensions: [],
          prompts: [],
          skills: ["!**/*", "+skills/skill-a", "+skills/skill-c"],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(packageManager.resolution.resolve());
      expect(result.skills.some((r) => packagePaths.isEnabled(r, "skill-a", "includes"))).toBe(
        true,
      );
      expect(result.skills.some((r) => packagePaths.isDisabled(r, "skill-b", "includes"))).toBe(
        true,
      );
      expect(result.skills.some((r) => packagePaths.isEnabled(r, "skill-c", "includes"))).toBe(
        true,
      );
    }),
  );

const shouldForceIncludeAfterSpecificExclusion = () =>
  runTest(
    Effect.gen(function* () {
      const extDir = joinPath(agentDir, "extensions");
      yield* makeDirectory(extDir);
      yield* writeTextFile(joinPath(extDir, "a.ts"), "export default function() {}");
      yield* writeTextFile(joinPath(extDir, "b.ts"), "export default function() {}");

      settingsManager.resources.setExtensionPaths([
        "extensions",
        "!extensions/b.ts",
        "+extensions/b.ts",
      ]);

      const result = yield* awaited(packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "a.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "b.ts"))).toBe(true);
    }),
  );

const shouldHandleForceIncludeInManifestPatterns = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "manifest-force-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "one.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "two.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "three.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: {
            extensions: ["extensions", "!**/two.ts", "+extensions/two.ts"],
          },
          name: "manifest-force-pkg",
        }),
      );

      const result = yield* awaited(packageManager.resolution.resolveExtensionSources([pkgDir]));
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "one.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "two.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "three.ts"))).toBe(true);
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

  describe("force-include patterns", () => {
    it(
      "should force-include extensions with + pattern after exclusion",
      shouldForceIncludeExtensionsWithPatternAfter,
    );

    it(
      "should force-include overrides exclude in package filters",
      shouldForceIncludeOverridesExcludeInPackage,
    );

    it("should force-include multiple resources", shouldForceIncludeMultipleResources);

    it("should force-include after specific exclusion", shouldForceIncludeAfterSpecificExclusion);

    it(
      "should handle force-include in manifest patterns",
      shouldHandleForceIncludeInManifestPatterns,
    );
  });
});
