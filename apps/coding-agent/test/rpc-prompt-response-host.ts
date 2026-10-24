import testing from "@msa/testing";
import { Effect } from "effect";

import type agentSessionTypes from "../src/core/agent-session.types.ts";
import AuthStorage from "../src/core/auth-storage.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import codingAgent from "../src/index.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
import rpcPromptResponseAgent from "./rpc-prompt-response-agent.ts";
import type rpcPromptResponseHostTypes from "./rpc-prompt-response-host.types.ts";
import utilities from "./utilities.ts";

const { AgentSession, SessionManager } = codingAgent;

const { createTestResourceLoader } = utilities;
const { createScriptedAgent } = rpcPromptResponseAgent;
const { createInMemoryModelRegistry, getModelRuntime } = modelRuntimeTestUtils;

const { awaited, joinPath, makeTempDir, randomSuffix, removePath, toJsonText, writeTextFile } =
  testing;

const stubRuntimeHost = (session: agentSessionTypes.AgentSession) => ({
  dispose: () => Promise.resolve(),
  fork: () => Promise.resolve({ cancelled: true, selectedText: "" }),
  newSession: () => Promise.resolve({ cancelled: true }),
  session,
  setRebindSession: () => {},
  switchSession: () => Promise.resolve({ cancelled: true }),
});

const prepareTempDir = Effect.fn("prepareTempDir")(function* () {
  const tempDir = yield* makeTempDir(`msa-rpc-prompt-${yield* randomSuffix}-`);
  yield* writeTextFile(
    joinPath(tempDir, "settings.json"),
    yield* toJsonText({ memory: { enabled: false } }),
  );
  return tempDir;
});

const createRuntimeHost = (
  options: rpcPromptResponseHostTypes.RuntimeHostOptions,
): Effect.Effect<{
  runtimeHost: Record<string, unknown> & { session: agentSessionTypes.AgentSession };
  cleanup: Effect.Effect<void>;
}> =>
  Effect.gen(function* () {
    const tempDir = yield* prepareTempDir();
    const agent = createScriptedAgent(options);

    const sessionManager = SessionManager.inMemory();
    const settingsManager = yield* Effect.promise(() => SettingsManager.create(tempDir, tempDir));
    const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
    const modelRegistry = yield* awaited(createInMemoryModelRegistry(authStorage));
    if (options.withAuth) {
      yield* awaited(
        authStorage.modify("anthropic-api", () =>
          Promise.resolve({ key: "test-key", type: "api_key" as const }),
        ),
      );
    }

    const session = new AgentSession({
      agent,
      agentDir: tempDir,
      cwd: tempDir,
      modelRuntime: getModelRuntime(modelRegistry),
      resourceLoader: createTestResourceLoader(
        options.extensionsResult === undefined
          ? {}
          : { extensionsResult: options.extensionsResult },
      ),
      sessionManager,
      settingsManager,
    });

    const runtimeHost = stubRuntimeHost(session);

    const cleanup = Effect.gen(function* () {
      yield* Effect.ignore(awaited(session.run.lifecycle.abort()));
      session.dispose();
      yield* removePath(tempDir);
    });

    return { cleanup, runtimeHost };
  });

const rpcPromptResponseHost = {
  createRuntimeHost,
};

export default rpcPromptResponseHost;
