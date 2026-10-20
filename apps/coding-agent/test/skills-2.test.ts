import testing from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import type diagnosticsTypes from "../src/core/diagnostics.ts";
import skillsModule from "../src/core/skills.ts";
import skillsSupport from "./skills-support.ts";

const { loadSkillsFromDir } = skillsModule;

const { fixturesDir } = skillsSupport;

const { joinPath } = testing;

const shouldLoadAllSkillsFromFixtureDirectory = () => {
  const { skills } = loadSkillsFromDir({
    dir: fixturesDir,
    source: "test",
  });

  expect(skills.length).toBeGreaterThanOrEqual(6);
};

const shouldReturnEmptyForNonExistentDirectory = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: "/non/existent/path",
    source: "test",
  });

  expect(skills).toHaveLength(0);
  expect(diagnostics).toHaveLength(0);
};

const shouldUseParentDirectoryNameWhenName = () => {
  const { skills } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "valid-skill"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(skills[0]?.name).toBe("valid-skill");
};

const shouldParseDisableModelInvocationFrontmatterField = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "disable-model-invocation"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(skills[0]?.name).toBe("disable-model-invocation");
  expect(skills[0]?.disableModelInvocation).toBe(true);

  expect(
    diagnostics.some((d: diagnosticsTypes.ResourceDiagnostic) =>
      d.message.includes("unknown frontmatter field"),
    ),
  ).toBe(false);
};

const shouldDefaultDisablemodelinvocationToFalseWhenNot = () => {
  const { skills } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "valid-skill"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(skills[0]?.disableModelInvocation).toBe(false);
};

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
