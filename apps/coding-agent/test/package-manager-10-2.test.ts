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

const shouldExpandInExclusionAndExactPatterns = () =>
  runTest(
    Effect.gen(function* () {
      const previousHome = readEnv("HOME");
      vi.stubEnv("HOME", tempDir);

      try {
        const skillsDir = joinPath(tempDir, "extra", "skills");
        for (const name of ["keep", "glob-excluded", "exact-excluded"]) {
          yield* makeDirectory(joinPath(skillsDir, name));
          yield* writeTextFile(
            joinPath(skillsDir, name, "SKILL.md"),
            `---\nname: ${name}\ndescription: ${name}\n---\n`,
          );
        }

        settingsManager.setSkillPaths([
          "~/extra/skills",
          "!~/extra/skills/glob-*",
          "-~/extra/skills/exact-excluded",
        ]);

        const result = yield* awaited(packageManager.resolve());
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
      const extDir = joinPath(agentDir, "extensions");
      yield* makeDirectory(extDir);
      yield* writeTextFile(joinPath(extDir, "keep.ts"), "export default function() {}");
      yield* writeTextFile(joinPath(extDir, "remove.ts"), "export default function() {}");

      settingsManager.setExtensionPaths(["extensions", "!**/remove.ts"]);

      const result = yield* awaited(packageManager.resolve());
      expect(result.extensions.some((r) => packagePaths.isEnabled(r, "keep.ts"))).toBe(true);
      expect(result.extensions.some((r) => packagePaths.isDisabled(r, "remove.ts"))).toBe(true);
    }),
  );

const shouldFilterThemesWithGlobPatterns = () =>
  runTest(
    Effect.gen(function* () {
      const themesDir = joinPath(agentDir, "themes");
      yield* makeDirectory(themesDir);
      yield* writeTextFile(joinPath(themesDir, "dark.json"), "{}");
      yield* writeTextFile(joinPath(themesDir, "light.json"), "{}");
      yield* writeTextFile(joinPath(themesDir, "funky.json"), "{}");

      settingsManager.setThemePaths(["themes", "!funky.json"]);

      const result = yield* awaited(packageManager.resolve());
      expect(result.themes.some((r) => packagePaths.isEnabled(r, "dark.json"))).toBe(true);
      expect(result.themes.some((r) => packagePaths.isEnabled(r, "light.json"))).toBe(true);
      expect(result.themes.some((r) => packagePaths.isDisabled(r, "funky.json"))).toBe(true);
    }),
  );

const shouldFilterPromptsWithExclusionPattern = () =>
  runTest(
    Effect.gen(function* () {
      const promptsDir = joinPath(agentDir, "prompts");
      yield* makeDirectory(promptsDir);
      yield* writeTextFile(joinPath(promptsDir, "review.md"), "Review code");
      yield* writeTextFile(joinPath(promptsDir, "explain.md"), "Explain code");

      settingsManager.setPromptTemplatePaths(["prompts", "!explain.md"]);

      const result = yield* awaited(packageManager.resolve());
      expect(result.prompts.some((r) => packagePaths.isEnabled(r, "review.md"))).toBe(true);
      expect(result.prompts.some((r) => packagePaths.isDisabled(r, "explain.md"))).toBe(true);
    }),
  );

const shouldFilterSkillsWithExclusionPattern = () =>
  runTest(
    Effect.gen(function* () {
      const skillsDir = joinPath(agentDir, "skills");
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

      settingsManager.setSkillPaths(["skills", "!**/bad-skill"]);

      const result = yield* awaited(packageManager.resolve());
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
      const extDir = joinPath(agentDir, "extensions");
      yield* makeDirectory(extDir);
      const extPath = joinPath(extDir, "my-ext.ts");
      yield* writeTextFile(extPath, "export default function() {}");

      settingsManager.setExtensionPaths(["extensions/my-ext.ts"]);

      const result = yield* awaited(packageManager.resolve());
      expect(result.extensions.some((r) => r.path === extPath && r.enabled)).toBe(true);
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
