import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { readEnv } from "../src/core/process-env.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { packagePaths } = packageManagerSupport;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } =
  testing;

let tempDir: string;

let agentDir: string;

let settingsManager: SettingsManager;

let packageManager: DefaultPackageManager;

let previousOfflineEnv: string | undefined;

const shouldForceIncludeThemes = () =>
  runTest(
    Effect.gen(function* () {
      const themesDir = joinPath(agentDir, "themes");
      yield* makeDirectory(themesDir);
      yield* writeTextFile(joinPath(themesDir, "dark.json"), "{}");
      yield* writeTextFile(joinPath(themesDir, "light.json"), "{}");
      yield* writeTextFile(joinPath(themesDir, "special.json"), "{}");

      settingsManager.setThemePaths(["themes", "!themes/*.json", "+themes/special.json"]);

      const result = yield* awaited(packageManager.resolve());
      expect(result.themes.some((r) => packagePaths.isDisabled(r, "dark.json"))).toBe(true);
      expect(result.themes.some((r) => packagePaths.isDisabled(r, "light.json"))).toBe(true);
      expect(result.themes.some((r) => packagePaths.isEnabled(r, "special.json"))).toBe(true);
    }),
  );

const shouldForceIncludePrompts = () =>
  runTest(
    Effect.gen(function* () {
      const promptsDir = joinPath(agentDir, "prompts");
      yield* makeDirectory(promptsDir);
      yield* writeTextFile(joinPath(promptsDir, "review.md"), "Review");
      yield* writeTextFile(joinPath(promptsDir, "explain.md"), "Explain");
      yield* writeTextFile(joinPath(promptsDir, "debug.md"), "Debug");

      settingsManager.setPromptTemplatePaths(["prompts", "!prompts/*.md", "+prompts/debug.md"]);

      const result = yield* awaited(packageManager.resolve());
      expect(result.prompts.some((r) => packagePaths.isDisabled(r, "review.md"))).toBe(true);
      expect(result.prompts.some((r) => packagePaths.isDisabled(r, "explain.md"))).toBe(true);
      expect(result.prompts.some((r) => packagePaths.isEnabled(r, "debug.md"))).toBe(true);
    }),
  );

const shouldForceExcludeTopLevelResources = () =>
  runTest(
    Effect.gen(function* () {
      const extDir = joinPath(agentDir, "extensions");
      yield* makeDirectory(extDir);
      yield* writeTextFile(joinPath(extDir, "alpha.ts"), "export default function() {}");
      yield* writeTextFile(joinPath(extDir, "beta.ts"), "export default function() {}");

      settingsManager.setExtensionPaths([
        "extensions",
        "+extensions/alpha.ts",
        "-extensions/alpha.ts",
      ]);

      const result = yield* awaited(packageManager.resolve());
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "beta.ts"))).toBe(true);
    }),
  );

const shouldForceExcludeInPackageFilters = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, "force-exclude-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "alpha.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "beta.ts"),
        "export default function() {}",
      );

      settingsManager.setPackages([
        {
          extensions: ["extensions/*.ts", "+extensions/alpha.ts", "-extensions/alpha.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(packageManager.resolve());
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "beta.ts"))).toBe(true);
    }),
  );

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

  describe("force-include patterns", () => {
    it("should force-include themes", shouldForceIncludeThemes);

    it("should force-include prompts", shouldForceIncludePrompts);
  });

  describe("force-exclude patterns", () => {
    it("should force-exclude top-level resources", shouldForceExcludeTopLevelResources);

    it("should force-exclude in package filters", shouldForceExcludeInPackageFilters);
  });
});
