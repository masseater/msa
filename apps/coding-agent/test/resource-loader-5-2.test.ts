import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";

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

const shouldSkipSkillDiscoveryWhenNoskillsIs = Effect.gen(function* () {
  const skillsDir = joinPath(agentDir, "skills");
  yield* makeDirectory(skillsDir);
  yield* writeTextFile(
    joinPath(skillsDir, "test-skill.md"),
    `---
name: test-skill
description: A test skill
---
Content`,
  );

  const loader = new DefaultResourceLoader({ agentDir, cwd, noSkills: true });
  yield* awaited(loader.reload());

  const { skills } = loader.getSkills();
  expect(skills).toEqual([]);
});

const shouldStillLoadAdditionalSkillPathsWhen = Effect.gen(function* () {
  const customSkillDir = joinPath(tempDir, "custom-skills");
  yield* makeDirectory(customSkillDir);
  yield* writeTextFile(
    joinPath(customSkillDir, "custom.md"),
    `---
name: custom
description: Custom skill
---
Content`,
  );

  const loader = new DefaultResourceLoader({
    additionalSkillPaths: [customSkillDir],
    agentDir,
    cwd,
    noSkills: true,
  });
  yield* awaited(loader.reload());

  const { skills } = loader.getSkills();
  expect(skills.some((s) => s.name === "custom")).toBe(true);
});

const shouldApplySkillsoverride = Effect.gen(function* () {
  const injectedSkill: Skill = {
    baseDir: "/fake",
    description: "Injected skill",
    disableModelInvocation: false,
    filePath: "/fake/path",
    name: "injected",
    sourceInfo: createSyntheticSourceInfo("/fake/path", { source: "custom" }),
  };
  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    skillsOverride: () => ({
      diagnostics: [],
      skills: [injectedSkill],
    }),
  });
  yield* awaited(loader.reload());

  const { skills } = loader.getSkills();
  expect(skills).toHaveLength(1);
  expect(skills[0]?.name).toBe("injected");
});

const shouldApplySystempromptoverride = Effect.gen(function* () {
  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    systemPromptOverride: () => "Custom system prompt",
  });
  yield* awaited(loader.reload());

  expect(loader.getSystemPrompt()).toBe("Custom system prompt");
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

  describe("noSkills option", () => {
    it("should skip skill discovery when noSkills is true", () =>
      runTest(shouldSkipSkillDiscoveryWhenNoskillsIs));

    it("should still load additional skill paths when noSkills is true", () =>
      runTest(shouldStillLoadAdditionalSkillPathsWhen));
  });

  describe("override functions", () => {
    it("should apply skillsOverride", () => runTest(shouldApplySkillsoverride));

    it("should apply systemPromptOverride", () => runTest(shouldApplySystempromptoverride));
  });
});
