import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { getThemesDir } from "../src/config.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

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

const shouldSkipProjectResourcesThatRequireTrustPart1 = () =>
  Effect.gen(function* () {
    const msaDir = joinPath(cwd, ".msa");
    const extensionsDir = joinPath(msaDir, "extensions");
    const skillDir = joinPath(msaDir, "skills", "project-skill");
    const promptsDir = joinPath(msaDir, "prompts");
    const themesDir = joinPath(msaDir, "themes");
    yield* makeDirectory(extensionsDir);
    yield* makeDirectory(skillDir);
    yield* makeDirectory(promptsDir);
    yield* makeDirectory(themesDir);
    return { extensionsDir, msaDir, promptsDir, skillDir, themesDir };
  });

const shouldSkipProjectResourcesThatRequireTrust = Effect.gen(function* () {
  const { extensionsDir, msaDir, promptsDir, skillDir, themesDir } =
    yield* shouldSkipProjectResourcesThatRequireTrustPart1();
  yield* writeTextFile(joinPath(msaDir, "SYSTEM.md"), "Project system prompt.");
  yield* writeTextFile(joinPath(agentDir, "SYSTEM.md"), "Global system prompt.");
  yield* writeTextFile(joinPath(agentDir, "AGENTS.md"), "Global instructions");
  yield* writeTextFile(joinPath(cwd, "AGENTS.md"), "Project instructions");
  yield* writeTextFile(
    joinPath(extensionsDir, "project.ts"),
    `throw new Error("should not load");`,
  );
  yield* writeTextFile(
    joinPath(skillDir, "SKILL.md"),
    `---
name: project-skill
description: Project skill
---
Project skill content`,
  );
  yield* writeTextFile(joinPath(promptsDir, "project.md"), "Project prompt");
  const themeData = (yield* fromJsonText(
    yield* readTextFile(joinPath(getThemesDir(), "dark.json")),
  )) as {
    name: string;
  };
  themeData.name = "project-theme";
  yield* writeTextFile(joinPath(themesDir, "project.json"), yield* toJsonText(themeData));
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });

  const loader = new DefaultResourceLoader({ agentDir, cwd, settingsManager });
  yield* awaited(loader.reload());

  expect(loader.getSystemPrompt()).toBe("Global system prompt.");
  expect(
    loader
      .getAgentsFiles()
      .agentsFiles.some((file) => file.path === joinPath(agentDir, "AGENTS.md")),
  ).toBe(true);
  expect(
    loader.getAgentsFiles().agentsFiles.some((file) => file.path === joinPath(cwd, "AGENTS.md")),
  ).toBe(true);
  expect(loader.getExtensions().extensions).toHaveLength(0);
  expect(loader.getExtensions().errors).toEqual([]);
  expect(loader.getSkills().skills.some((skill) => skill.name === "project-skill")).toBe(false);
  expect(loader.getPrompts().prompts.some((prompt) => prompt.name === "project")).toBe(false);
  expect(loader.getThemes().themes.some((theme) => theme.name === "project-theme")).toBe(false);
});

const shouldDiscoverAppendSystemMd = Effect.gen(function* () {
  const msaDir = joinPath(cwd, ".msa");
  yield* makeDirectory(msaDir);
  yield* writeTextFile(joinPath(msaDir, "APPEND_SYSTEM.md"), "Additional instructions.");

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  expect(loader.getAppendSystemPrompt()).toContain("Additional instructions.");
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
    it("should skip project resources that require trust when project is not trusted", () =>
      runTest(shouldSkipProjectResourcesThatRequireTrust));

    it("should discover APPEND_SYSTEM.md", () => runTest(shouldDiscoverAppendSystemMd));
  });
});
