import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type diagnosticsTypes from "../src/core/diagnostics.ts";
import skillDirectory from "../src/core/skill-directory.ts";
import skillsSupport from "./skills-support.ts";

const { loadSkillsFromDir } = skillDirectory;

const { fixturesDir } = skillsSupport;

const { joinPath, runTest } = testing;

const shouldLoadAllSkillsFromFixtureDirectory = () =>
  runTest(
    Effect.gen(function* () {
      const { skills } = yield* Effect.promise(() =>
        loadSkillsFromDir({
          dir: fixturesDir,
          source: "test",
        }),
      );

      expect(skills.length).toBeGreaterThanOrEqual(6);
    }),
  );

const shouldReturnEmptyForNonExistentDirectory = () =>
  runTest(
    Effect.gen(function* () {
      const { skills, diagnostics } = yield* Effect.promise(() =>
        loadSkillsFromDir({
          dir: "/non/existent/path",
          source: "test",
        }),
      );

      expect(skills).toHaveLength(0);
      expect(diagnostics).toHaveLength(0);
    }),
  );

const shouldUseParentDirectoryNameWhenName = () =>
  runTest(
    Effect.gen(function* () {
      const { skills } = yield* Effect.promise(() =>
        loadSkillsFromDir({
          dir: joinPath(fixturesDir, "valid-skill"),
          source: "test",
        }),
      );

      expect(skills).toHaveLength(1);
      expect(skills[0]?.name).toBe("valid-skill");
    }),
  );

const shouldParseDisableModelInvocationFrontmatterField = () =>
  runTest(
    Effect.gen(function* () {
      const { skills, diagnostics } = yield* Effect.promise(() =>
        loadSkillsFromDir({
          dir: joinPath(fixturesDir, "disable-model-invocation"),
          source: "test",
        }),
      );

      expect(skills).toHaveLength(1);
      expect(skills[0]?.name).toBe("disable-model-invocation");
      expect(skills[0]?.disableModelInvocation).toBe(true);

      expect(
        diagnostics.some((d: diagnosticsTypes.ResourceDiagnostic) =>
          d.message.includes("unknown frontmatter field"),
        ),
      ).toBe(false);
    }),
  );

const shouldDefaultDisablemodelinvocationToFalseWhenNot = () =>
  runTest(
    Effect.gen(function* () {
      const { skills } = yield* Effect.promise(() =>
        loadSkillsFromDir({
          dir: joinPath(fixturesDir, "valid-skill"),
          source: "test",
        }),
      );

      expect(skills).toHaveLength(1);
      expect(skills[0]?.disableModelInvocation).toBe(false);
    }),
  );

describe("skills", () => {
  describe("loadSkillsFromDir", () => {
    it("should load all skills from fixture directory", shouldLoadAllSkillsFromFixtureDirectory);

    it("should return empty for non-existent directory", shouldReturnEmptyForNonExistentDirectory);

    it(
      "should use parent directory name when name not in frontmatter",
      shouldUseParentDirectoryNameWhenName,
    );

    it(
      "should parse disable-model-invocation frontmatter field",
      shouldParseDisableModelInvocationFrontmatterField,
    );

    it(
      "should default disableModelInvocation to false when not specified",
      shouldDefaultDisablemodelinvocationToFalseWhenNot,
    );
  });
});
