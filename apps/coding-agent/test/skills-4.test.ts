import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import skillDirectory from "../src/core/skill-directory.ts";
import type skillsTypes from "../src/core/skills.types.ts";

const { loadSkillsFromDir } = skillDirectory;

const { joinPath, resolvePath, runTest } = testing;

const collisionFixturesDir = resolvePath(__dirname, "fixtures/skills-collision");

const shouldDetectNameCollisionsAndKeepFirst = () =>
  runTest(
    Effect.gen(function* () {
      const first = yield* Effect.promise(() =>
        loadSkillsFromDir({
          dir: joinPath(collisionFixturesDir, "first"),
          source: "first",
        }),
      );

      const second = yield* Effect.promise(() =>
        loadSkillsFromDir({
          dir: joinPath(collisionFixturesDir, "second"),
          source: "second",
        }),
      );

      const skillMap = new Map<string, skillsTypes.Skill>();
      const collisionWarnings: Array<{ skillPath: string; message: string }> = [];

      for (const skill of first.skills) {
        skillMap.set(skill.name, skill);
      }

      for (const skill of second.skills) {
        const existing = skillMap.get(skill.name);
        if (existing === undefined) {
          skillMap.set(skill.name, skill);
        } else {
          collisionWarnings.push({
            message: `name collision: "${skill.name}" already loaded from ${existing.filePath}`,
            skillPath: skill.filePath,
          });
        }
      }

      expect(skillMap.size).toBe(1);
      expect(skillMap.get("calendar")?.sourceInfo.source).toBe("first");
      expect(collisionWarnings).toHaveLength(1);
      expect(collisionWarnings[0]?.message).toContain("name collision");
    }),
  );

describe("skills collision handling", () => {
  it("should detect name collisions and keep first skill", shouldDetectNameCollisionsAndKeepFirst);
});
