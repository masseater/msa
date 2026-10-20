import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultResourceLoader from "../src/core/default-resource-loader.ts";
import SettingsManager from "../src/core/settings-manager.ts";

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

const shouldHonorOverridesForAutoDiscoveredResources = Effect.gen(function* () {
  const settingsManager = SettingsManager.inMemory();
  settingsManager.setExtensionPaths(["-extensions/disabled.ts"]);
  settingsManager.setSkillPaths(["-skills/skip-skill"]);
  settingsManager.setPromptTemplatePaths(["-prompts/skip.md"]);
  settingsManager.setThemePaths(["-themes/skip.json"]);

  const extensionsDir = joinPath(agentDir, "extensions");
  yield* makeDirectory(extensionsDir);
  yield* writeTextFile(joinPath(extensionsDir, "disabled.ts"), "export default function() {}");

  const skillDir = joinPath(agentDir, "skills", "skip-skill");
  yield* makeDirectory(skillDir);
  yield* writeTextFile(
    joinPath(skillDir, "SKILL.md"),
    `---
name: skip-skill
description: Skip me
---
Content`,
  );

  const promptsDir = joinPath(agentDir, "prompts");
  yield* makeDirectory(promptsDir);
  yield* writeTextFile(joinPath(promptsDir, "skip.md"), "Skip prompt");

  const themesDir = joinPath(agentDir, "themes");
  yield* makeDirectory(themesDir);
  yield* writeTextFile(joinPath(themesDir, "skip.json"), "{}");

  const loader = new DefaultResourceLoader({ agentDir, cwd, settingsManager });
  yield* awaited(loader.reload());

  const { extensions } = loader.getExtensions();
  const { skills } = loader.getSkills();
  const { prompts } = loader.getPrompts();
  const { themes } = loader.getThemes();

  expect(extensions.some((e) => e.path.endsWith("disabled.ts"))).toBe(false);
  expect(skills.some((s) => s.name === "skip-skill")).toBe(false);
  expect(prompts.some((p) => p.name === "skip")).toBe(false);
  expect(themes.some((t) => t.sourcePath?.endsWith("skip.json"))).toBe(false);
});

const shouldDiscoverAgentsMdContextFiles = Effect.gen(function* () {
  yield* writeTextFile(joinPath(cwd, "AGENTS.md"), "# Project Guidelines\n\nBe helpful.");

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  const { agentsFiles } = loader.getAgentsFiles();
  expect(agentsFiles.some((f) => f.path.includes("AGENTS.md"))).toBe(true);
});

const shouldPreferAgentsOverrideMdWithinEach = Effect.gen(function* () {
  const nestedCwd = joinPath(cwd, "service");
  yield* makeDirectory(nestedCwd);
  yield* writeTextFile(joinPath(agentDir, "AGENTS.md"), "global instructions");
  yield* writeTextFile(joinPath(agentDir, "AGENTS.override.md"), "global override");
  yield* writeTextFile(joinPath(cwd, "AGENTS.md"), "project instructions");
  yield* writeTextFile(joinPath(nestedCwd, "AGENTS.md"), "service instructions");
  yield* writeTextFile(joinPath(nestedCwd, "AGENTS.override.md"), "service override");

  const loader = new DefaultResourceLoader({ agentDir, cwd: nestedCwd });
  yield* awaited(loader.reload());

  expect(loader.getAgentsFiles().agentsFiles).toEqual([
    { content: "global override", path: joinPath(agentDir, "AGENTS.override.md") },
    { content: "project instructions", path: joinPath(cwd, "AGENTS.md") },
    { content: "service override", path: joinPath(nestedCwd, "AGENTS.override.md") },
  ]);
});

const shouldIgnoreContextFileCandidatesThatAre = Effect.gen(function* () {
  yield* makeDirectory(joinPath(cwd, "AGENTS.override.md"));
  yield* makeDirectory(joinPath(cwd, "AGENTS.md"));
  yield* writeTextFile(joinPath(cwd, "CLAUDE.md"), "Fallback instructions");
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  expect(loader.getAgentsFiles().agentsFiles).toContainEqual({
    content: "Fallback instructions",
    path: joinPath(cwd, "CLAUDE.md"),
  });
  expect(consoleError).not.toHaveBeenCalledWith(
    expect.stringContaining(joinPath(cwd, "AGENTS.md")),
  );
  expect(consoleError).not.toHaveBeenCalledWith(
    expect.stringContaining(joinPath(cwd, "AGENTS.override.md")),
  );
  consoleError.mockRestore();
});

const shouldSkipContextFileDiscoveryWhenNocontextfiles = Effect.gen(function* () {
  yield* writeTextFile(joinPath(cwd, "AGENTS.override.md"), "# Override Guidelines\n\nBe helpful.");
  yield* writeTextFile(joinPath(cwd, "AGENTS.md"), "# Project Guidelines\n\nBe helpful.");
  yield* writeTextFile(joinPath(cwd, "CLAUDE.md"), "# Claude Guidelines\n\nBe helpful.");

  const loader = new DefaultResourceLoader({ agentDir, cwd, noContextFiles: true });
  yield* awaited(loader.reload());

  const { agentsFiles } = loader.getAgentsFiles();
  expect(agentsFiles).toEqual([]);
});

const shouldDiscoverSystemMdFromCwdMsa = Effect.gen(function* () {
  const msaDir = joinPath(cwd, ".msa");
  yield* makeDirectory(msaDir);
  yield* writeTextFile(joinPath(msaDir, "SYSTEM.md"), "You are a helpful assistant.");

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  expect(loader.getSystemPrompt()).toBe("You are a helpful assistant.");
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
    it("should honor overrides for auto-discovered resources", () =>
      runTest(shouldHonorOverridesForAutoDiscoveredResources));

    it("should discover AGENTS.md context files", () =>
      runTest(shouldDiscoverAgentsMdContextFiles));

    it("should prefer AGENTS.override.md within each directory while preserving ancestor layering", () =>
      runTest(shouldPreferAgentsOverrideMdWithinEach));
  });
});

describe("DefaultResourceLoader", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(removePath(tempDir)));

  describe("reload", () => {
    it("should ignore context file candidates that are directories", () =>
      runTest(shouldIgnoreContextFileCandidatesThatAre));

    it("should skip context file discovery when noContextFiles is true", () =>
      runTest(shouldSkipContextFileDiscoveryWhenNocontextfiles));

    it("should discover SYSTEM.md from cwd/.msa", () => runTest(shouldDiscoverSystemMdFromCwdMsa));
  });
});
