import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { awaited, runTest, currentTimeMillis, randomSuffixSync, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";

describe("createAgentSession skills option", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(() => {
    tempDir = joinPath(tmpdir(), `msa-sdk-test-${currentTimeMillis()}-${randomSuffixSync()}`);
    skillsDir = joinPath(tempDir, "skills", "test-skill");
    mkdirSync(skillsDir, { recursive: true });

    writeFileSync(
      joinPath(skillsDir, "SKILL.md"),
      `---
name: test-skill
description: A test skill for SDK tests.
---

# Test Skill

This is a test skill.
`,
    );
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should discover skills by default and expose them on session.skills", () =>
    runTest(
      Effect.gen(function* () {
        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir: tempDir,
            sessionManager: SessionManager.inMemory(),
          }),
        );

        expect(session.resourceLoader.getSkills().skills.length).toBeGreaterThan(0);
        expect(session.resourceLoader.getSkills().skills.some((s) => s.name === "test-skill")).toBe(
          true,
        );
      }),
    ));

  it("should have empty skills when resource loader returns none (--no-skills)", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const resourceLoader: ResourceLoader = {
          getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
          getSkills: () => ({ skills: [], diagnostics: [] }),
          getPrompts: () => ({ prompts: [], diagnostics: [] }),
          getThemes: () => ({ themes: [], diagnostics: [] }),
          getAgentsFiles: () => ({ agentsFiles: [] }),
          getSystemPrompt: () => undefined,
          getSystemPromptSource: () => undefined,
          getAppendSystemPrompt: () => [],
          getAppendSystemPromptSources: () => [],
          extendResources: () => {},
          reload: () => effectRunPromise(Effect.sync(() => {})),
        };

        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir: tempDir,
            sessionManager: SessionManager.inMemory(),
            resourceLoader,
          }),
        );

        expect(session.resourceLoader.getSkills().skills).toEqual([]);
        expect(session.resourceLoader.getSkills().diagnostics).toEqual([]);
      }),
    ));

  it("should use provided skills when resource loader supplies them", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const customSkill = {
          name: "custom-skill",
          description: "A custom skill",
          filePath: "/fake/path/SKILL.md",
          baseDir: "/fake/path",
          sourceInfo: createSyntheticSourceInfo("/fake/path/SKILL.md", { source: "sdk" }),
          disableModelInvocation: false,
        };

        const resourceLoader: ResourceLoader = {
          getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
          getSkills: () => ({ skills: [customSkill], diagnostics: [] }),
          getPrompts: () => ({ prompts: [], diagnostics: [] }),
          getThemes: () => ({ themes: [], diagnostics: [] }),
          getAgentsFiles: () => ({ agentsFiles: [] }),
          getSystemPrompt: () => undefined,
          getSystemPromptSource: () => undefined,
          getAppendSystemPrompt: () => [],
          getAppendSystemPromptSources: () => [],
          extendResources: () => {},
          reload: () => effectRunPromise(Effect.sync(() => {})),
        };

        const { session } = yield* awaited(
          createAgentSession({
            cwd: tempDir,
            agentDir: tempDir,
            sessionManager: SessionManager.inMemory(),
            resourceLoader,
          }),
        );

        expect(session.resourceLoader.getSkills().skills).toEqual([customSkill]);
        expect(session.resourceLoader.getSkills().diagnostics).toEqual([]);
      }),
    ));
});
