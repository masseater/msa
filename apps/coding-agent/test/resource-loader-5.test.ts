import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import DefaultResourceLoader from "../src/core/default-resource-loader.ts";

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  removePath,
  runTest,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let cwd: string;

const shouldLoadSkillsAndPromptsWithExtensionSetup = () =>
  Effect.gen(function* () {
    const extraSkillDir = joinPath(tempDir, "extra-skills", "extra-skill");
    yield* makeDirectory(extraSkillDir);
    const skillPath = joinPath(extraSkillDir, "SKILL.md");
    yield* writeTextFile(
      skillPath,
      `---
name: extra-skill
description: Extra skill
---
Extra content`,
    );

    const extraPromptDir = joinPath(tempDir, "extra-prompts");
    yield* makeDirectory(extraPromptDir);
    const promptPath = joinPath(extraPromptDir, "extra.md");
    yield* writeTextFile(
      promptPath,
      `---
description: Extra prompt
---
Extra prompt content`,
    );
    return { extraPromptDir, extraSkillDir, promptPath, skillPath };
  });

const shouldLoadSkillsAndPromptsWithExtension = Effect.gen(function* () {
  const { extraPromptDir, extraSkillDir, promptPath, skillPath } =
    yield* shouldLoadSkillsAndPromptsWithExtensionSetup();

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  loader.extendResources({
    promptPaths: [
      {
        metadata: {
          baseDir: extraPromptDir,
          origin: "top-level",
          scope: "temporary",
          source: "extension:extra",
        },
        path: promptPath,
      },
    ],
    skillPaths: [
      {
        metadata: {
          baseDir: extraSkillDir,
          origin: "top-level",
          scope: "temporary",
          source: "extension:extra",
        },
        path: extraSkillDir,
      },
    ],
  });

  const { skills } = loader.getSkills();
  const loadedSkill = skills.find((skill) => skill.name === "extra-skill");
  expect(loadedSkill).toBeDefined();
  expect(loadedSkill?.sourceInfo?.source).toBe("extension:extra");
  expect(loadedSkill?.sourceInfo?.path).toBe(skillPath);

  const { prompts } = loader.getPrompts();
  const loadedPrompt = prompts.find((prompt) => prompt.name === "extra");
  expect(loadedPrompt).toBeDefined();
  expect(loadedPrompt?.sourceInfo?.source).toBe("extension:extra");
  expect(loadedPrompt?.sourceInfo?.path).toBe(promptPath);
});

const shouldLoadExtensionResourcesReturnedAsFile = Effect.gen(function* () {
  const extraSkillDir = joinPath(tempDir, "extra skills", "file-url-skill");
  yield* makeDirectory(extraSkillDir);
  const skillPath = joinPath(extraSkillDir, "SKILL.md");
  yield* writeTextFile(
    skillPath,
    `---
name: file-url-skill
description: File URL skill
---
Extra content`,
  );

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  loader.extendResources({
    skillPaths: [
      {
        metadata: {
          baseDir: extraSkillDir,
          origin: "top-level",
          scope: "temporary",
          source: "extension:file-url",
        },
        path: pathToFileURL(extraSkillDir).href,
      },
    ],
  });

  const { skills, diagnostics } = loader.getSkills();
  expect(diagnostics).toEqual([]);
  const loadedSkill = skills.find((skill) => skill.name === "file-url-skill");
  expect(loadedSkill).toBeDefined();
  expect(loadedSkill?.filePath).toBe(skillPath);
  expect(loadedSkill?.sourceInfo?.source).toBe("extension:file-url");
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

  describe("extendResources", () => {
    it("should load skills and prompts with extension metadata", () =>
      runTest(shouldLoadSkillsAndPromptsWithExtension));

    it("should load extension resources returned as file URLs", () =>
      runTest(shouldLoadExtensionResourcesReturnedAsFile));
  });
});
