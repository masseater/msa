import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();

const { packagePaths } = packageManagerSupport;

const { awaited, joinPath, makeDirectory, runTest, writeTextFile } = testing;

const shouldForceIncludeThemes = () =>
  runTest(
    Effect.gen(function* () {
      const themesDir = joinPath(fixture.agentDir, "themes");
      yield* makeDirectory(themesDir);
      yield* writeTextFile(joinPath(themesDir, "dark.json"), "{}");
      yield* writeTextFile(joinPath(themesDir, "light.json"), "{}");
      yield* writeTextFile(joinPath(themesDir, "special.json"), "{}");

      fixture.settingsManager.resources.setThemePaths([
        "themes",
        "!themes/*.json",
        "+themes/special.json",
      ]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.themes.some((r) => packagePaths.isDisabled(r, "dark.json"))).toBe(true);
      expect(result.themes.some((r) => packagePaths.isDisabled(r, "light.json"))).toBe(true);
      expect(result.themes.some((r) => packagePaths.isEnabled(r, "special.json"))).toBe(true);
    }),
  );

const shouldForceIncludePrompts = () =>
  runTest(
    Effect.gen(function* () {
      const promptsDir = joinPath(fixture.agentDir, "prompts");
      yield* makeDirectory(promptsDir);
      yield* writeTextFile(joinPath(promptsDir, "review.md"), "Review");
      yield* writeTextFile(joinPath(promptsDir, "explain.md"), "Explain");
      yield* writeTextFile(joinPath(promptsDir, "debug.md"), "Debug");

      fixture.settingsManager.resources.setPromptTemplatePaths([
        "prompts",
        "!prompts/*.md",
        "+prompts/debug.md",
      ]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.prompts.some((r) => packagePaths.isDisabled(r, "review.md"))).toBe(true);
      expect(result.prompts.some((r) => packagePaths.isDisabled(r, "explain.md"))).toBe(true);
      expect(result.prompts.some((r) => packagePaths.isEnabled(r, "debug.md"))).toBe(true);
    }),
  );

const shouldForceExcludeTopLevelResources = () =>
  runTest(
    Effect.gen(function* () {
      const extDir = joinPath(fixture.agentDir, "extensions");
      yield* makeDirectory(extDir);
      yield* writeTextFile(joinPath(extDir, "alpha.ts"), "export default function() {}");
      yield* writeTextFile(joinPath(extDir, "beta.ts"), "export default function() {}");

      fixture.settingsManager.resources.setExtensionPaths([
        "extensions",
        "+extensions/alpha.ts",
        "-extensions/alpha.ts",
      ]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "beta.ts"))).toBe(true);
    }),
  );

const shouldForceExcludeInPackageFilters = () =>
  runTest(
    Effect.gen(function* () {
      const pkgDir = joinPath(fixture.tempDir, "force-exclude-pkg");
      yield* makeDirectory(joinPath(pkgDir, "extensions"));
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "alpha.ts"),
        "export default function() {}",
      );
      yield* writeTextFile(
        joinPath(pkgDir, "extensions", "beta.ts"),
        "export default function() {}",
      );

      fixture.settingsManager.resources.setPackages([
        {
          extensions: ["extensions/*.ts", "+extensions/alpha.ts", "-extensions/alpha.ts"],
          prompts: [],
          skills: [],
          source: pkgDir,
          themes: [],
        },
      ]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "alpha.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "beta.ts"))).toBe(true);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("force-include patterns", () => {
    it("should force-include themes", shouldForceIncludeThemes);

    it("should force-include prompts", shouldForceIncludePrompts);
  });

  describe("force-exclude patterns", () => {
    it("should force-exclude top-level resources", shouldForceExcludeTopLevelResources);

    it("should force-exclude in package filters", shouldForceExcludeInPackageFilters);
  });
});
