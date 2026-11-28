import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import skillsSupport from "./skills-support.ts";

const { fixturesDir, loadedFrom } = skillsSupport;

const { runTest } = testing;

const MINIMUM_FIXTURE_SKILLS = 6;

const shouldLoadAllSkillsFromFixtureDirectory = () =>
  runTest(
    Effect.gen(function* () {
      const { skills } = yield* loadedFrom(fixturesDir);

      expect(skills.length).toBeGreaterThanOrEqual(MINIMUM_FIXTURE_SKILLS);
    }),
  );

const shouldReturnEmptyForNonExistentDirectory = () =>
  runTest(
    Effect.gen(function* () {
      const { skills, diagnostics } = yield* loadedFrom("/non/existent/path");

      expect(skills).toHaveLength(0);
      expect(diagnostics).toHaveLength(0);
    }),
  );

describe("skills", () => {
  describe("loadSkillsFromDir", () => {
    it("should load all skills from fixture directory", shouldLoadAllSkillsFromFixtureDirectory);

    it("should return empty for non-existent directory", shouldReturnEmptyForNonExistentDirectory);
  });
});
