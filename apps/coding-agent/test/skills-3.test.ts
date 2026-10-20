import { homedir } from "os";

import testing from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import type diagnosticsTypes from "../src/core/diagnostics.ts";
import skillsModule from "../src/core/skills.ts";
import type skillsTypes from "../src/core/skills.types.ts";
import sourceInfoModule from "../src/core/source-info.ts";
import skillsSupport from "./skills-support.ts";

const { formatSkillsForPrompt, loadSkills, loadSkillsFromDir } = skillsModule;
const { createSyntheticSourceInfo } = sourceInfoModule;

const { fixturesDir } = skillsSupport;

const { joinPath, resolvePath } = testing;

const collisionFixturesDir = resolvePath(__dirname, "fixtures/skills-collision");

function createTestSkill(options: {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation?: boolean;
  source?: string;
}): skillsTypes.Skill {
  return {
    baseDir: options.baseDir,
    description: options.description,
    disableModelInvocation: options.disableModelInvocation ?? false,
    filePath: options.filePath,
    name: options.name,
    sourceInfo: createSyntheticSourceInfo(options.filePath, { source: options.source ?? "test" }),
  };
}

const emptyAgentDir = resolvePath(__dirname, "fixtures/empty-agent");

const emptyCwd = resolvePath(__dirname, "fixtures/empty-cwd");

const shouldReturnEmptyStringForNoSkills = () => {
  const result = formatSkillsForPrompt([]);
  expect(result).toBe("");
};

const shouldFormatSkillsAsXml = () => {
  const skills: skillsTypes.Skill[] = [
    createTestSkill({
      baseDir: "/path/to/skill",
      description: "A test skill.",
      filePath: "/path/to/skill/SKILL.md",
      name: "test-skill",
    }),
  ];

  const result = formatSkillsForPrompt(skills);

  expect(result).toContain("<available_skills>");
  expect(result).toContain("</available_skills>");
  expect(result).toContain("<skill>");
  expect(result).toContain("<name>test-skill</name>");
  expect(result).toContain("<description>A test skill.</description>");
  expect(result).toContain("<location>/path/to/skill/SKILL.md</location>");
};

const shouldIncludeIntroTextBeforeXml = () => {
  const skills: skillsTypes.Skill[] = [
    createTestSkill({
      baseDir: "/path/to/skill",
      description: "A test skill.",
      filePath: "/path/to/skill/SKILL.md",
      name: "test-skill",
    }),
  ];

  const result = formatSkillsForPrompt(skills);
  const xmlStart = result.indexOf("<available_skills>");
  const introText = result.substring(0, xmlStart);

  expect(introText).toContain("The following skills provide specialized instructions");
  expect(introText).toContain("Use the read tool to load a skill's file");
};

const shouldEscapeXmlSpecialCharacters = () => {
  const skills: skillsTypes.Skill[] = [
    createTestSkill({
      baseDir: "/path/to/skill",
      description: 'A skill with <special> & "characters".',
      filePath: "/path/to/skill/SKILL.md",
      name: "test-skill",
    }),
  ];

  const result = formatSkillsForPrompt(skills);

  expect(result).toContain("&lt;special&gt;");
  expect(result).toContain("&amp;");
  expect(result).toContain("&quot;characters&quot;");
};

const shouldFormatMultipleSkills = () => {
  const skills: skillsTypes.Skill[] = [
    createTestSkill({
      baseDir: "/path/one",
      description: "First skill.",
      filePath: "/path/one/SKILL.md",
      name: "skill-one",
    }),
    createTestSkill({
      baseDir: "/path/two",
      description: "Second skill.",
      filePath: "/path/two/SKILL.md",
      name: "skill-two",
    }),
  ];

  const result = formatSkillsForPrompt(skills);

  expect(result).toContain("<name>skill-one</name>");
  expect(result).toContain("<name>skill-two</name>");
  expect((result.match(/<skill>/gu) || []).length).toBe(2);
};

const shouldExcludeSkillsWithDisablemodelinvocationFromPrompt = () => {
  const skills: skillsTypes.Skill[] = [
    createTestSkill({
      baseDir: "/path/visible",
      description: "A visible skill.",
      filePath: "/path/visible/SKILL.md",
      name: "visible-skill",
    }),
    createTestSkill({
      baseDir: "/path/hidden",
      description: "A hidden skill.",
      disableModelInvocation: true,
      filePath: "/path/hidden/SKILL.md",
      name: "hidden-skill",
    }),
  ];

  const result = formatSkillsForPrompt(skills);

  expect(result).toContain("<name>visible-skill</name>");
  expect(result).not.toContain("<name>hidden-skill</name>");
  expect((result.match(/<skill>/gu) || []).length).toBe(1);
};

const shouldReturnEmptyStringWhenAllSkills = () => {
  const skills: skillsTypes.Skill[] = [
    createTestSkill({
      baseDir: "/path/hidden",
      description: "A hidden skill.",
      disableModelInvocation: true,
      filePath: "/path/hidden/SKILL.md",
      name: "hidden-skill",
    }),
  ];

  const result = formatSkillsForPrompt(skills);
  expect(result).toBe("");
};

const shouldLoadFromExplicitSkillpaths = () => {
  const { skills, diagnostics } = loadSkills({
    agentDir: emptyAgentDir,
    cwd: emptyCwd,
    includeDefaults: true,
    skillPaths: [joinPath(fixturesDir, "valid-skill")],
  });
  expect(skills).toHaveLength(1);
  expect(skills[0]?.sourceInfo.scope).toBe("temporary");
  expect(diagnostics).toHaveLength(0);
};

const shouldWarnWhenSkillPathDoesNot = () => {
  const { skills, diagnostics } = loadSkills({
    agentDir: emptyAgentDir,
    cwd: emptyCwd,
    includeDefaults: true,
    skillPaths: ["/non/existent/path"],
  });
  expect(skills).toHaveLength(0);
  expect(
    diagnostics.some((d: diagnosticsTypes.ResourceDiagnostic) =>
      d.message.includes("does not exist"),
    ),
  ).toBe(true);
};

const shouldExpandInSkillpaths = () => {
  const homeSkillsDir = joinPath(homedir(), ".msa/agent/skills");
  const { skills: withTilde } = loadSkills({
    agentDir: emptyAgentDir,
    cwd: emptyCwd,
    includeDefaults: true,
    skillPaths: ["~/.msa/agent/skills"],
  });
  const { skills: withoutTilde } = loadSkills({
    agentDir: emptyAgentDir,
    cwd: emptyCwd,
    includeDefaults: true,
    skillPaths: [homeSkillsDir],
  });
  expect(withTilde.length).toBe(withoutTilde.length);
};

const shouldDetectNameCollisionsAndKeepFirst = () => {
  const first = loadSkillsFromDir({
    dir: joinPath(collisionFixturesDir, "first"),
    source: "first",
  });

  const second = loadSkillsFromDir({
    dir: joinPath(collisionFixturesDir, "second"),
    source: "second",
  });

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
};

describe("skills", () => {
  describe("formatSkillsForPrompt", () => {
    it("should return empty string for no skills", shouldReturnEmptyStringForNoSkills);

    it("should format skills as XML", shouldFormatSkillsAsXml);

    it("should include intro text before XML", shouldIncludeIntroTextBeforeXml);

    it("should escape XML special characters", shouldEscapeXmlSpecialCharacters);

    it("should format multiple skills", shouldFormatMultipleSkills);

    it(
      "should exclude skills with disableModelInvocation from prompt",
      shouldExcludeSkillsWithDisablemodelinvocationFromPrompt,
    );

    it(
      "should return empty string when all skills have disableModelInvocation",
      shouldReturnEmptyStringWhenAllSkills,
    );
  });

  describe("loadSkills with options", () => {
    it("should load from explicit skillPaths", shouldLoadFromExplicitSkillpaths);

    it("should warn when skill path does not exist", shouldWarnWhenSkillPathDoesNot);

    it("should expand ~ in skillPaths", shouldExpandInSkillpaths);
  });

  describe("collision handling", () => {
    it(
      "should detect name collisions and keep first skill",
      shouldDetectNameCollisionsAndKeepFirst,
    );
  });
});
