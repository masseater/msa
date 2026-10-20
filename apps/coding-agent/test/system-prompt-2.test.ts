import { describe, expect, test } from "vite-plus/test";

import type skillsTypes from "../src/core/skills.types.ts";
import sourceInfoModule from "../src/core/source-info.ts";
import systemPrompt from "../src/core/system-prompt.ts";

const { createSyntheticSourceInfo } = sourceInfoModule;
const { buildSystemPrompt } = systemPrompt;

const testSkill: skillsTypes.Skill = {
  baseDir: "/skills/test-skill",
  description: "A test skill.",
  disableModelInvocation: false,
  filePath: "/skills/test-skill/SKILL.md",
  name: "test-skill",
  sourceInfo: createSyntheticSourceInfo("/skills/test-skill/SKILL.md", { source: "test" }),
};

const build = (hiddenTools: string[]) =>
  buildSystemPrompt({
    contextFiles: [],
    cwd: process.cwd(),
    hiddenTools,
    selectedTools: ["read", "bash", "run"],
    skills: [testSkill],
    toolGuidelines: { read: ["Use read for files."], run: ["Prefer run."] },
    toolSnippets: { bash: "Run commands", read: "Read files", run: "Run a task" },
  });

const appendsPromptguidelinesToDefaultGuidelines = () => {
  const prompt = buildSystemPrompt({
    contextFiles: [],
    cwd: process.cwd(),
    promptGuidelines: ["Use dynamic_tool for project summaries."],
    selectedTools: ["read", "dynamic_tool"],
    skills: [],
  });

  expect(prompt).toContain("- Use dynamic_tool for project summaries.");
};

const deduplicatesAndTrimsPromptguidelines = () => {
  const prompt = buildSystemPrompt({
    contextFiles: [],
    cwd: process.cwd(),
    promptGuidelines: [
      "Use dynamic_tool for summaries.",
      "  Use dynamic_tool for summaries.  ",
      "   ",
    ],
    selectedTools: ["read", "dynamic_tool"],
    skills: [],
  });

  expect(prompt.match(/- Use dynamic_tool for summaries\./gu)).toHaveLength(1);
};

const omitsSkillsWithoutReadOrBash = () => {
  const prompt = buildSystemPrompt({
    contextFiles: [],
    cwd: process.cwd(),
    selectedTools: ["write"],
    skills: [testSkill],
  });

  expect(prompt).not.toContain("<available_skills>");
};

const leavesHiddenToolsOutOfTheTool = () => {
  const prompt = build(["read", "bash"]);

  expect(prompt).toContain("<tools>\n- run: Run a task\n");
  expect(prompt).not.toContain("- read: ");
  expect(prompt).not.toContain("Use read for files.");
  expect(prompt).not.toContain("Use bash for file operations");
  expect(prompt).toContain("- Prefer run.");
};

const keepsSkillsWithoutNamingAHiddenReader = () => {
  expect(build(["read", "bash"])).toContain(
    "\nLoad a skill's file when the task matches its description.",
  );
  expect(build(["read"])).toContain("Use bash to load a skill's file");
  expect(build([])).toContain("Use the read tool to load a skill's file");
};

describe("buildSystemPrompt", () => {
  describe("prompt guidelines", () => {
    test(
      "appends promptGuidelines to default guidelines",
      appendsPromptguidelinesToDefaultGuidelines,
    );

    test("deduplicates and trims promptGuidelines", deduplicatesAndTrimsPromptguidelines);
  });

  describe("skills", () => {
    test.each([
      { customPrompt: undefined, name: "default prompt" },
      { customPrompt: "Custom system prompt", name: "custom prompt" },
    ])("includes skills with only bash in the $name", ({ customPrompt }) => {
      const prompt = buildSystemPrompt({
        ...(customPrompt === undefined ? {} : { customPrompt }),
        contextFiles: [],
        cwd: process.cwd(),
        selectedTools: ["bash"],
        skills: [testSkill],
      });

      expect(prompt).toContain("<skills>");
      expect(prompt).toContain("<available_skills>");
      expect(prompt).toContain("<name>test-skill</name>");
      expect(prompt).toContain("Use bash to load a skill's file");
    });

    test("omits skills without read or bash", omitsSkillsWithoutReadOrBash);
  });

  describe("hidden tools", () => {
    test("leaves hidden tools out of the tool list and rules", leavesHiddenToolsOutOfTheTool);

    test("keeps skills without naming a hidden reader", keepsSkillsWithoutNamingAHiddenReader);
  });
});
