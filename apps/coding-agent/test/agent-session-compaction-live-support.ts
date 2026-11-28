import agentModule from "@msa/agent-core";
import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import AuthStorage from "../src/core/auth-storage.ts";
import src from "../src/index.ts";
import type srcTypes from "../src/index.types.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
import utilities from "./utilities.ts";

const { AgentSession, SessionManager, SettingsManager, createCodingTools } = src;
const { getModel, streamSimple } = compat;

const { Agent } = agentModule;

const { createTestResourceLoader } = utilities;

const { createModelRegistry, getModelRuntime } = modelRuntimeTestUtils;

const { awaited, currentTimeMillis, joinPath, makeDirectory, removePath, runTest, tempRoot } =
  testing;

interface LiveState {
  tempDir: string;
  session: srcTypes.AgentSession | undefined;
  sessionManager: srcTypes.SessionManager | undefined;
  events: srcTypes.AgentSessionEvent[];
}

function createAgent() {
  return new Agent({
    initialState: {
      model: getModel("anthropic-api", "claude-sonnet-4-5")!,
      systemPrompt: "You are a helpful assistant. Be concise.",
      tools: createCodingTools(process.cwd()),
    },
    streamFn: streamSimple,
  });
}

const createSession = (state: LiveState, inMemory: boolean) =>
  runTest(
    Effect.gen(function* () {
      const { tempDir } = state;
      state.sessionManager = inMemory ? SessionManager.inMemory() : SessionManager.create(tempDir);
      const settingsManager = yield* Effect.promise(() => SettingsManager.create(tempDir, tempDir));
      settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
      const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
      const modelRegistry = yield* awaited(createModelRegistry(authStorage));
      const session = new AgentSession({
        agent: createAgent(),
        agentDir: tempDir,
        cwd: tempDir,
        modelRuntime: getModelRuntime(modelRegistry),
        resourceLoader: createTestResourceLoader(),
        sessionManager: state.sessionManager,
        settingsManager,
      });
      state.session = session;
      session.subscribe((event) => {
        state.events.push(event);
      });
      return yield* awaited(session);
    }),
  );

const beforeEachHook = (state: LiveState) =>
  runTest(
    Effect.gen(function* () {
      state.tempDir = joinPath(tempRoot(), `msa-compaction-test-${currentTimeMillis()}`);
      yield* makeDirectory(state.tempDir);
      state.events = [];
    }),
  );

const afterEachHook = (state: LiveState) =>
  runTest(
    Effect.gen(function* () {
      state.session?.dispose();
      if (state.tempDir.length > 0) {
        yield* removePath(state.tempDir);
      }
    }),
  );

function liveCompaction() {
  const state: LiveState = {
    events: [],
    session: undefined,
    sessionManager: undefined,
    tempDir: "",
  };
  return {
    afterEachHook: () => afterEachHook(state),
    beforeEachHook: () => beforeEachHook(state),
    createSession: (inMemory = false) => createSession(state, inMemory),
    get events() {
      return state.events;
    },
    get session(): srcTypes.AgentSession {
      return state.session!;
    },
    get sessionManager(): srcTypes.SessionManager {
      return state.sessionManager!;
    },
  };
}

const agentSessionCompactionLiveSupport = { liveCompaction };

export default agentSessionCompactionLiveSupport;
