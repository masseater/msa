import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import config from "../src/config.ts";
import DefaultResourceLoader from "../src/core/default-resource-loader.ts";

const { getThemesDir } = config;

const {
  awaited,
  currentTimeMillis,
  fromJsonText,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let cwd: string;

const shouldDiscoverPromptsFromAgentdir = Effect.gen(function* () {
  const promptsDir = joinPath(agentDir, "prompts");
  yield* makeDirectory(promptsDir);
  yield* writeTextFile(
    joinPath(promptsDir, "test-prompt.md"),
    `---
description: A test prompt
---
Prompt content.`,
  );

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  const { prompts } = loader.getPrompts();
  expect(prompts.some((p) => p.name === "test-prompt")).toBe(true);
});

const shouldReportInvalidPromptFrontmatterWhileLoading = Effect.gen(function* () {
  const promptsDir = joinPath(agentDir, "prompts");
  const invalidPromptPath = joinPath(promptsDir, "invalid.md");
  yield* makeDirectory(promptsDir);
  yield* writeTextFile(
    invalidPromptPath,
    "---\ndescription: Broken: unquoted colon\n---\nDo something.\n",
  );
  yield* writeTextFile(joinPath(promptsDir, "valid.md"), "Valid prompt content.");

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  const { prompts, diagnostics } = loader.getPrompts();
  expect(prompts.map((prompt) => prompt.name)).toEqual(["valid"]);
  expect(diagnostics).toEqual([
    expect.objectContaining({
      message: expect.stringContaining("line 1, column 14"),
      path: invalidPromptPath,
      type: "warning" as const,
    }),
  ]);
});

const shouldPreferProjectResourcesOverUserOnPart1 = () =>
  Effect.gen(function* () {
    const userPromptsDir = joinPath(agentDir, "prompts");
    const projectPromptsDir = joinPath(cwd, ".msa", "prompts");
    yield* makeDirectory(userPromptsDir);
    yield* makeDirectory(projectPromptsDir);
    const userPromptPath = joinPath(userPromptsDir, "commit.md");
    const projectPromptPath = joinPath(projectPromptsDir, "commit.md");
    yield* writeTextFile(userPromptPath, "User prompt");
    yield* writeTextFile(projectPromptPath, "Project prompt");

    const userSkillDir = joinPath(agentDir, "skills", "collision-skill");
    const projectSkillDir = joinPath(cwd, ".msa", "skills", "collision-skill");
    yield* makeDirectory(userSkillDir);
    yield* makeDirectory(projectSkillDir);
    const userSkillPath = joinPath(userSkillDir, "SKILL.md");
    const projectSkillPath = joinPath(projectSkillDir, "SKILL.md");
    return { projectPromptPath, projectSkillPath, userSkillPath };
  });

const shouldPreferProjectResourcesOverUserOn = Effect.gen(function* () {
  const { projectPromptPath, projectSkillPath, userSkillPath } =
    yield* shouldPreferProjectResourcesOverUserOnPart1();
  yield* writeTextFile(
    userSkillPath,
    `---
name: collision-skill
description: user
---
User skill`,
  );
  yield* writeTextFile(
    projectSkillPath,
    `---
name: collision-skill
description: project
---
Project skill`,
  );

  const baseTheme = (yield* fromJsonText(
    yield* readTextFile(joinPath(getThemesDir(), "dark.json")),
  )) as {
    name: string;
    vars?: Record<string, string>;
  };
  baseTheme.name = "collision-theme";
  const userThemePath = joinPath(agentDir, "themes", "collision.json");
  const projectThemePath = joinPath(cwd, ".msa", "themes", "collision.json");
  yield* makeDirectory(joinPath(agentDir, "themes"));
  yield* makeDirectory(joinPath(cwd, ".msa", "themes"));
  yield* writeTextFile(userThemePath, yield* toJsonText(baseTheme));
  if (baseTheme.vars !== undefined) {
    baseTheme.vars["accent"] = "#ff00ff";
  }
  yield* writeTextFile(projectThemePath, yield* toJsonText(baseTheme));

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  const prompt = loader.getPrompts().prompts.find((p) => p.name === "commit");
  expect(prompt?.filePath).toBe(projectPromptPath);

  const skill = loader.getSkills().skills.find((s) => s.name === "collision-skill");
  expect(skill?.filePath).toBe(projectSkillPath);

  const theme = loader.getThemes().themes.find((t) => t.name === "collision-theme");
  expect(theme?.sourcePath).toBe(projectThemePath);
});

const beforeEachHook = Effect.gen(function* () {
  tempDir = joinPath(tmpdir(), `rl-test-${currentTimeMillis()}-${randomSuffixSync()}`);
  agentDir = joinPath(tempDir, "agent");
  cwd = joinPath(tempDir, "project");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(cwd);
});

describe("DefaultResourceLoader", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(removePath(tempDir)));

  describe("reload", () => {
    it("should discover prompts from agentDir", () => runTest(shouldDiscoverPromptsFromAgentdir));

    it("should report invalid prompt frontmatter while loading valid siblings", () =>
      runTest(shouldReportInvalidPromptFrontmatterWhileLoading));

    it("should prefer project resources over user on name collisions", () =>
      runTest(shouldPreferProjectResourcesOverUserOn));
  });
});
