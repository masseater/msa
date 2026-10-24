import agentModule from "@msa/agent-core";
import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import AgentSession from "../src/core/agent-session.ts";
import AuthStorage from "../src/core/auth-storage.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
import utilities from "./utilities.ts";
const { getModel, streamSimple } = compat;

const { Agent } = agentModule;

const { createModelRegistry, getModelRuntime } = modelRuntimeTestUtils;
const { createTestResourceLoader } = utilities;

const { awaited, joinPath, makeTempDir, randomSuffix, removeDirs } = testing;

const tempDirs: string[] = [];
const settingsManagers: SettingsManager[] = [];

const removeSessionDirs: Effect.Effect<void> = Effect.suspend(() =>
  Effect.andThen(
    Effect.promise(() =>
      Promise.all(settingsManagers.splice(0).map((manager) => manager.persistence.flush())),
    ),
    removeDirs(tempDirs.splice(0)),
  ),
);

const sonnet = getModel("anthropic-api", "claude-sonnet-4-5")!;
const opus = getModel("anthropic-api", "claude-opus-4-8")!;

const createSession = (options: { scoped: boolean; persistedScope?: string[] }) =>
  Effect.gen(function* () {
    const tempDir = yield* makeTempDir(`msa-default-scope-${yield* randomSuffix}-`);
    tempDirs.push(tempDir);

    const settingsManager = yield* Effect.promise(() => SettingsManager.create(tempDir, tempDir));
    settingsManagers.push(settingsManager);
    if (options.persistedScope !== undefined) {
      settingsManager.models.setEnabledModels(options.persistedScope);
    }

    const authStorage = AuthStorage.inMemory({
      "anthropic-api": { key: "test-key", type: "api_key" as const },
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
      agentDir: tempDir,
      cwd: tempDir,
      modelRuntime,
      resourceLoader: createTestResourceLoader(),
      scopedModels: options.scoped ? [{ model: sonnet }] : [],
      sessionManager: SessionManager.inMemory(tempDir),
      settingsManager,
    });

    return yield* awaited({ session, settingsManager });
  });

const modelResolverSessionSupport = {
  createSession,
  opus,
  removeSessionDirs,
  sonnet,
};

export default modelResolverSessionSupport;
