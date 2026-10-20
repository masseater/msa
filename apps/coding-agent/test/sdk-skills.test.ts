import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import loader from "../src/core/extensions/loader.ts";
import type resourceLoaderTypes from "../src/core/resource-loader.types.ts";
import sdk from "../src/core/sdk.ts";
import SessionManager from "../src/core/session-manager.ts";
import sourceInfoModule from "../src/core/source-info.ts";

const { createAgentSession } = sdk;
const { createExtensionRuntime } = loader;
const { createSyntheticSourceInfo } = sourceInfoModule;

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

let skillsDir: string;

const shouldDiscoverSkillsByDefaultAndExpose = () =>
  runTest(
    Effect.gen(function* () {
      const { session } = yield* awaited(
        createAgentSession({
          agentDir: tempDir,
          cwd: tempDir,
          sessionManager: SessionManager.inMemory(),
        }),
      );

      expect(session.resourceLoader.getSkills().skills.length).toBeGreaterThan(0);
      expect(session.resourceLoader.getSkills().skills.some((s) => s.name === "test-skill")).toBe(
        true,
      );
    }),
  );

const shouldHaveEmptySkillsWhenResourceLoader = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const resourceLoader: resourceLoaderTypes.ResourceLoader = {
        extendResources: () => {},
        getAgentsFiles: () => ({ agentsFiles: [] }),
        getAppendSystemPrompt: () => [],
        getAppendSystemPromptSources: () => [],
        getExtensions: () => ({ errors: [], extensions: [], runtime: createExtensionRuntime() }),
        getPrompts: () => ({ diagnostics: [], prompts: [] }),
        getSkills: () => ({ diagnostics: [], skills: [] }),
        getSystemPrompt: () => undefined,
        getSystemPromptSource: () => undefined,
        getThemes: () => ({ diagnostics: [], themes: [] }),
        reload: () => effectRunPromise(Effect.sync(() => {})),
      };

      const { session } = yield* awaited(
        createAgentSession({
          agentDir: tempDir,
          cwd: tempDir,
          resourceLoader,
          sessionManager: SessionManager.inMemory(),
        }),
      );

      expect(session.resourceLoader.getSkills().skills).toEqual([]);
      expect(session.resourceLoader.getSkills().diagnostics).toEqual([]);
    }),
  );

const shouldUseProvidedSkillsWhenResourceLoader = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const customSkill = {
        baseDir: "/fake/path",
        description: "A custom skill",
        disableModelInvocation: false,
        filePath: "/fake/path/SKILL.md",
        name: "custom-skill",
        sourceInfo: createSyntheticSourceInfo("/fake/path/SKILL.md", { source: "sdk" }),
      };

      const resourceLoader: resourceLoaderTypes.ResourceLoader = {
        extendResources: () => {},
        getAgentsFiles: () => ({ agentsFiles: [] }),
        getAppendSystemPrompt: () => [],
        getAppendSystemPromptSources: () => [],
        getExtensions: () => ({ errors: [], extensions: [], runtime: createExtensionRuntime() }),
        getPrompts: () => ({ diagnostics: [], prompts: [] }),
        getSkills: () => ({ diagnostics: [], skills: [customSkill] }),
        getSystemPrompt: () => undefined,
        getSystemPromptSource: () => undefined,
        getThemes: () => ({ diagnostics: [], themes: [] }),
        reload: () => effectRunPromise(Effect.sync(() => {})),
      };

      const { session } = yield* awaited(
        createAgentSession({
          agentDir: tempDir,
          cwd: tempDir,
          resourceLoader,
          sessionManager: SessionManager.inMemory(),
        }),
      );

      expect(session.resourceLoader.getSkills().skills).toEqual([customSkill]);
      expect(session.resourceLoader.getSkills().diagnostics).toEqual([]);
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = joinPath(tmpdir(), `msa-sdk-test-${currentTimeMillis()}-${randomSuffixSync()}`);
      skillsDir = joinPath(tempDir, "skills", "test-skill");
      yield* makeDirectory(skillsDir);
      yield* writeTextFile(
        joinPath(skillsDir, "SKILL.md"),
        `---
name: test-skill
description: A test skill for SDK tests.
---

# Test Skill

This is a test skill.
`,
      );
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (tempDir.length > 0) {
        yield* removePath(tempDir);
      }
    }),
  );

describe("createAgentSession skills option", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "should discover skills by default and expose them on session.skills",
    shouldDiscoverSkillsByDefaultAndExpose,
  );

  it(
    "should have empty skills when resource loader returns none (--no-skills)",
    shouldHaveEmptySkillsWhenResourceLoader,
  );

  it(
    "should use provided skills when resource loader supplies them",
    shouldUseProvidedSkillsWhenResourceLoader,
  );
});
