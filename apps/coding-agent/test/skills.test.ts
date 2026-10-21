import testing from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import type diagnosticsTypes from "../src/core/diagnostics.ts";
import skillDirectory from "../src/core/skill-directory.ts";
import skillsSupport from "./skills-support.ts";

const { loadSkillsFromDir } = skillDirectory;

const { fixturesDir } = skillsSupport;

const { joinPath } = testing;

const shouldLoadAValidSkill = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "valid-skill"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(skills[0]?.name).toBe("valid-skill");
  expect(skills[0]?.description).toBe("A valid skill for testing purposes.");
  expect(skills[0]?.sourceInfo.source).toBe("test");
  expect(diagnostics).toHaveLength(0);
};

const shouldAllowNamesThatDonTMatch = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "name-mismatch"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(skills[0]?.name).toBe("different-name");
  expect(
    diagnostics.some((d: diagnosticsTypes.ResourceDiagnostic) =>
      d.message.includes("does not match parent directory"),
    ),
  ).toBe(false);
};

const shouldWarnWhenNameContainsInvalidCharacters = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "invalid-name-chars"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(
    diagnostics.some((d: diagnosticsTypes.ResourceDiagnostic) =>
      d.message.includes("invalid characters"),
    ),
  ).toBe(true);
};

const shouldWarnWhenNameExceeds64Characters = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "long-name"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(
    diagnostics.some((d: diagnosticsTypes.ResourceDiagnostic) =>
      d.message.includes("exceeds 64 characters"),
    ),
  ).toBe(true);
};

const shouldWarnAndSkipSkillWhenDescription = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "missing-description"),
    source: "test",
  });

  expect(skills).toHaveLength(0);
  expect(
    diagnostics.some((d: diagnosticsTypes.ResourceDiagnostic) =>
      d.message.includes("description is required"),
    ),
  ).toBe(true);
};

const shouldIgnoreUnknownFrontmatterFields = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "unknown-field"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(diagnostics).toHaveLength(0);
};

const shouldLoadNestedSkillsRecursively = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "nested"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(skills[0]?.name).toBe("child-skill");
  expect(diagnostics).toHaveLength(0);
};

const shouldPreferADirectorySRootSkill = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "root-skill-preferred"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(skills[0]?.name).toBe("root-skill-preferred");
  expect(skills[0]?.description).toBe("Root skill should win.");
  expect(diagnostics).toHaveLength(0);
};

const shouldSkipFilesWithoutFrontmatter = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "no-frontmatter"),
    source: "test",
  });

  expect(skills).toHaveLength(0);
  expect(
    diagnostics.some((d: diagnosticsTypes.ResourceDiagnostic) =>
      d.message.includes("description is required"),
    ),
  ).toBe(true);
};

const shouldWarnAndSkipSkillWhenYaml = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "invalid-yaml"),
    source: "test",
  });

  expect(skills).toHaveLength(0);
  expect(
    diagnostics.some((d: diagnosticsTypes.ResourceDiagnostic) => d.message.includes("at line")),
  ).toBe(true);
};

const shouldPreserveMultilineDescriptionsFromYaml = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "multiline-description"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(skills[0]?.description).toContain("\n");
  expect(skills[0]?.description).toContain("This is a multiline description.");
  expect(diagnostics).toHaveLength(0);
};

const shouldWarnWhenNameContainsConsecutiveHyphens = () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: joinPath(fixturesDir, "consecutive-hyphens"),
    source: "test",
  });

  expect(skills).toHaveLength(1);
  expect(
    diagnostics.some((d: diagnosticsTypes.ResourceDiagnostic) =>
      d.message.includes("consecutive hyphens"),
    ),
  ).toBe(true);
};

describe("skills", () => {
  describe("loadSkillsFromDir", () => {
    it("should load a valid skill", shouldLoadAValidSkill);

    it("should allow names that don't match parent directory", shouldAllowNamesThatDonTMatch);

    it(
      "should warn when name contains invalid characters",
      shouldWarnWhenNameContainsInvalidCharacters,
    );

    it("should warn when name exceeds 64 characters", shouldWarnWhenNameExceeds64Characters);

    it(
      "should warn and skip skill when description is missing",
      shouldWarnAndSkipSkillWhenDescription,
    );

    it("should ignore unknown frontmatter fields", shouldIgnoreUnknownFrontmatterFields);

    it("should load nested skills recursively", shouldLoadNestedSkillsRecursively);

    it(
      "should prefer a directory's root SKILL.md over nested SKILL.md files",
      shouldPreferADirectorySRootSkill,
    );

    it("should skip files without frontmatter", shouldSkipFilesWithoutFrontmatter);

    it(
      "should warn and skip skill when YAML frontmatter is invalid",
      shouldWarnAndSkipSkillWhenYaml,
    );

    it(
      "should preserve multiline descriptions from YAML",
      shouldPreserveMultilineDescriptionsFromYaml,
    );

    it(
      "should warn when name contains consecutive hyphens",
      shouldWarnWhenNameContainsConsecutiveHyphens,
    );
  });
});
