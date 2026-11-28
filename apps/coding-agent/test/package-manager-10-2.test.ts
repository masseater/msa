import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import platform from "../src/core/platform/index.ts";
import packageManagerFixture from "./package-manager-fixture.ts";
import packageManagerScenario from "./package-manager-scenario.ts";
import packageManagerSupport from "./package-manager-support.ts";

const { usePackageManagerFixture } = packageManagerFixture;

const fixture = usePackageManagerFixture();
const { readEnv } = platform;

const { filesOf, resolves } = packageManagerScenario;

const { packagePaths, skillOf } = packageManagerSupport;

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
          yield* writeTextFile(joinPath(skillsDir, name, "SKILL.md"), skillOf(name, name, ""));
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

const scenarios = [
  {
    name: "should exclude extensions with ! pattern",
    scenario: {
      disabled: ["remove.ts"],
      enabled: ["keep.ts"],
      files: filesOf(
        ["extensions/keep.ts", "extensions/remove.ts"],
        "export default function() {}",
      ),
      kind: "extensions",
      patterns: ["extensions", "!**/remove.ts"],
      where: { agent: true },
    },
  },
  {
    name: "should filter themes with glob patterns",
    scenario: {
      disabled: ["funky.json"],
      enabled: ["dark.json", "light.json"],
      files: filesOf(["themes/dark.json", "themes/light.json", "themes/funky.json"], "{}"),
      kind: "themes",
      patterns: ["themes", "!funky.json"],
      where: { agent: true },
    },
  },
  {
    name: "should filter prompts with exclusion pattern",
    scenario: {
      disabled: ["explain.md"],
      enabled: ["review.md"],
      files: { "prompts/explain.md": "Explain code", "prompts/review.md": "Review code" },
      kind: "prompts",
      patterns: ["prompts", "!explain.md"],
      where: { agent: true },
    },
  },
  {
    name: "should filter skills with exclusion pattern",
    scenario: {
      disabled: ["bad-skill"],
      enabled: ["good-skill"],
      files: {
        "skills/bad-skill/SKILL.md": skillOf("bad-skill", "Bad"),
        "skills/good-skill/SKILL.md": skillOf("good-skill", "Good"),
      },
      kind: "skills",
      match: "includes",
      patterns: ["skills", "!**/bad-skill"],
      where: { agent: true },
    },
  },
] as const;

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

    for (const { name, scenario } of scenarios) {
      it(name, () => runTest(resolves(fixture, scenario)));
    }

    it(
      "should work without patterns (backward compatible)",
      shouldWorkWithoutPatternsBackwardCompatible,
    );
  });
});
