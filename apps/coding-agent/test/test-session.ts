import testing from "@msa/testing";
import { Effect } from "effect";

import AgentSession from "../src/core/agent-session.ts";
import AuthStorage from "../src/core/auth-storage.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
import testSessionAgent from "./test-session-agent.ts";
import utilities from "./utilities.ts";
import type utilitiesTypes from "./utilities.types.ts";
const { awaited, joinPath, makeTempDir, removePath, runTest } = testing;

const { createModelRegistry, getModelRuntime } = modelRuntimeTestUtils;

const { createTestResourceLoader } = utilities;

const { createAgent } = testSessionAgent;

const createSettings = (tempDir: string, options: utilitiesTypes.TestSessionOptions) => {
  const settingsManager = SettingsManager.create(tempDir, tempDir);
  if (options.settingsOverrides !== undefined) {
    settingsManager.applyOverrides(options.settingsOverrides);
  }
  return settingsManager;
};

const createTestSession = (
  options: utilitiesTypes.TestSessionOptions = {},
): Promise<utilitiesTypes.TestSessionContext> =>
  runTest(
    Effect.gen(function* () {
      const tempDir = yield* makeTempDir("msa-test-");
      const sessionManager =
        options.inMemory === true ? SessionManager.inMemory() : SessionManager.create(tempDir);
      const modelRegistry = yield* awaited(
        createModelRegistry(AuthStorage.create(joinPath(tempDir, "auth.json")), tempDir),
      );
      const session = new AgentSession({
        agent: createAgent(options),
        cwd: tempDir,
        modelRuntime: getModelRuntime(modelRegistry),
        resourceLoader: createTestResourceLoader(),
        sessionManager,
        settingsManager: createSettings(tempDir, options),
      });
      session.subscribe(() => {});
      const cleanup = () => {
        session.dispose();
        void runTest(removePath(tempDir));
      };
      return { cleanup, session, sessionManager, tempDir };
    }),
  );

const testSession = {
  createTestSession,
};

export default testSession;
