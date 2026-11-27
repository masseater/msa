import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import platform from "../src/core/platform/index.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();
const { readEnv } = platform;

const { packagePaths } = packageManagerSupport;

const { awaited, joinPath, makeDirectory, runTest, writeTextFile } = testing;

const shouldExpandInExclusionAndExactPatterns = () =>
  runTest(
    Effect.gen(function* () {
      const previousHome = readEnv("HOME");
      vi.stubEnv("HOME", fixture.tempDir);

      try {
        const skillsDir = joinPath(fixture.tempDir, "extra", "skills");
        for (const name of ["keep", "glob-excluded", "exact-excluded"]) {
          yield* makeDirectory(joinPath(skillsDir, name));
          yield* writeTextFile(
            joinPath(skillsDir, name, "SKILL.md"),
            `---\nname: ${name}\ndescription: ${name}\n---\n`,
          );
        }

        fixture.settingsManager.resources.setSkillPaths([
          "~/extra/skills",
          "!~/extra/skills/glob-*",
          "-~/extra/skills/exact-excluded",
        ]);

        const result = yield* awaited(fixture.packageManager.resolution.resolve());
        expect(result.skills.some((r) => packagePaths.isEnabled(r, "keep/SKILL.md"))).toBe(true);
        expect(
          result.skills.some((r) => packagePaths.isDisabled(r, "glob-excluded/SKILL.md")),
        ).toBe(true);
        expect(
          result.skills.some((r) => packagePaths.isDisabled(r, "exact-excluded/SKILL.md")),
        ).toBe(true);
      } finally {
        if (previousHome === undefined) {
          vi.stubEnv("HOME", undefined);
        } else {
          vi.stubEnv("HOME", previousHome);
        }
      }
    }),
  );

const shouldExcludeExtensionsWithPattern = () =>
  runTest(
    Effect.gen(function* () {
      const extDir = joinPath(fixture.agentDir, "extensions");
      yield* makeDirectory(extDir);
      yield* writeTextFile(joinPath(extDir, "keep.ts"), "export default function() {}");
      yield* writeTextFile(joinPath(extDir, "remove.ts"), "export default function() {}");

      fixture.settingsManager.resources.setExtensionPaths(["extensions", "!**/remove.ts"]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "keep.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "remove.ts"))).toBe(true);
    }),
  );

const shouldFilterThemesWithGlobPatterns = () =>
  runTest(
    Effect.gen(function* () {
      const themesDir = joinPath(fixture.agentDir, "themes");
      yield* makeDirectory(themesDir);
      yield* writeTextFile(joinPath(themesDir, "dark.json"), "{}");
      yield* writeTextFile(joinPath(themesDir, "light.json"), "{}");
      yield* writeTextFile(joinPath(themesDir, "funky.json"), "{}");

      fixture.settingsManager.resources.setThemePaths(["themes", "!funky.json"]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.themes.some((r) => packagePaths.isEnabled(r, "dark.json"))).toBe(true);
      expect(result.themes.some((r) => packagePaths.isEnabled(r, "light.json"))).toBe(true);
      expect(result.themes.some((r) => packagePaths.isDisabled(r, "funky.json"))).toBe(true);
    }),
  );

const shouldFilterPromptsWithExclusionPattern = () =>
  runTest(
    Effect.gen(function* () {
      const promptsDir = joinPath(fixture.agentDir, "prompts");
      yield* makeDirectory(promptsDir);
      yield* writeTextFile(joinPath(promptsDir, "review.md"), "Review code");
      yield* writeTextFile(joinPath(promptsDir, "explain.md"), "Explain code");

      fixture.settingsManager.resources.setPromptTemplatePaths(["prompts", "!explain.md"]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.prompts.some((r) => packagePaths.isEnabled(r, "review.md"))).toBe(true);
      expect(result.prompts.some((r) => packagePaths.isDisabled(r, "explain.md"))).toBe(true);
    }),
  );

const shouldFilterSkillsWithExclusionPattern = () =>
  runTest(
    Effect.gen(function* () {
      const skillsDir = joinPath(fixture.agentDir, "skills");
      yield* makeDirectory(joinPath(skillsDir, "good-skill"));
      yield* makeDirectory(joinPath(skillsDir, "bad-skill"));
      yield* writeTextFile(
        joinPath(skillsDir, "good-skill", "SKILL.md"),
        "---\nname: good-skill\ndescription: Good\n---\nContent",
      );
      yield* writeTextFile(
        joinPath(skillsDir, "bad-skill", "SKILL.md"),
        "---\nname: bad-skill\ndescription: Bad\n---\nContent",
      );

      fixture.settingsManager.resources.setSkillPaths(["skills", "!**/bad-skill"]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.skills.some((r) => packagePaths.isEnabled(r, "good-skill", "includes"))).toBe(
        true,
      );
      expect(result.skills.some((r) => packagePaths.isDisabled(r, "bad-skill", "includes"))).toBe(
        true,
      );
    }),
  );

const shouldWorkWithoutPatternsBackwardCompatible = () =>
  runTest(
    Effect.gen(function* () {
      const extDir = joinPath(fixture.agentDir, "extensions");
      yield* makeDirectory(extDir);
      const extPath = joinPath(extDir, "my-ext.ts");
      yield* writeTextFile(extPath, "export default function() {}");

      fixture.settingsManager.resources.setExtensionPaths(["extensions/my-ext.ts"]);

      const result = yield* awaited(fixture.packageManager.resolution.resolve());
      expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
    }),
  );

describe("DefaultPackageManager", () => {
  describe("pattern filtering in top-level arrays", () => {
    it("should expand ~ in exclusion and exact patterns", shouldExpandInExclusionAndExactPatterns);

    it("should exclude extensions with ! pattern", shouldExcludeExtensionsWithPattern);

    it("should filter themes with glob patterns", shouldFilterThemesWithGlobPatterns);

    it("should filter prompts with exclusion pattern", shouldFilterPromptsWithExclusionPattern);

    it("should filter skills with exclusion pattern", shouldFilterSkillsWithExclusionPattern);

    it(
      "should work without patterns (backward compatible)",
      shouldWorkWithoutPatternsBackwardCompatible,
    );
  });
});
