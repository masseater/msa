import { Agent } from "@msa/agent-core";
import { getModel, streamSimple } from "@msa/ai/compat";
import { awaited, joinPath, makeTempDir, randomSuffix, removeDirs } from "@msa/testing";
import { Effect } from "effect";

import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

const tempDirs: string[] = [];

export const removeSessionDirs: Effect.Effect<void> = Effect.suspend(() =>
  removeDirs(tempDirs.splice(0)),
);

export const sonnet = getModel("anthropic", "claude-sonnet-4-5")!;
export const opus = getModel("anthropic", "claude-opus-4-8")!;

export const createSession = (options: { scoped: boolean; persistedScope?: string[] }) =>
  Effect.gen(function* () {
    const tempDir = yield* makeTempDir(`msa-default-scope-${yield* randomSuffix}-`);
    tempDirs.push(tempDir);

    const settingsManager = SettingsManager.create(tempDir, tempDir);
    if (options.persistedScope !== undefined) {
      settingsManager.setEnabledModels(options.persistedScope);
    }

    const authStorage = AuthStorage.inMemory({
      anthropic: { type: "api_key" as const, key: "test-key" },
    });
    const modelRuntime = getModelRuntime(
      yield* awaited(createModelRegistry(authStorage, joinPath(tempDir, "models.json"))),
    );
    const agent = new Agent({
      initialState: {
        model: sonnet,
        systemPrompt: "test",
        tools: [],
      },
      streamFn: streamSimple,
    });
    const session = new AgentSession({
      agent,
      sessionManager: SessionManager.inMemory(tempDir),
      settingsManager,
      cwd: tempDir,
      modelRuntime,
      resourceLoader: createTestResourceLoader(),
      scopedModels: options.scoped ? [{ model: sonnet }] : [],
    });

    return yield* awaited({ session, settingsManager });
  });
