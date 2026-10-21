import agentModule from "@msa/agent-core";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import AuthStorage from "../src/core/auth-storage.ts";
import codingAgent from "../src/index.ts";
import type codingAgentTypes from "../src/index.types.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
import utilities from "./utilities.ts";

const { AgentSession, SessionManager, SettingsManager } = codingAgent;

const { getModel, streamSimple } = compat;

const { Agent } = agentModule;

const { createInMemoryModelRegistry, getModelRuntime } = modelRuntimeTestUtils;

const { createTestResourceLoader } = utilities;

const { awaited, runTest } = testing;

const model = getModel("anthropic-api", "claude-sonnet-4-5")!;

function createUsage(totalTokens: number): compatTypes.Usage {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
      total: 0,
    },
    input: totalTokens,
    output: 0,
    totalTokens,
  };
}

function createAssistantMessage(
  text: string,
  totalTokens: number,
  timestamp: number,
): compatTypes.AssistantMessage {
  return {
    api: model.api,
    content: [{ text, type: "text" as const }],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp,
    usage: createUsage(totalTokens),
  };
}

function createUserMessage(text: string, timestamp: number) {
  return {
    content: text,
    role: "user" as const,
    timestamp,
  };
}

function createSession() {
  return runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const settingsManager = SettingsManager.inMemory();
      const sessionManager = SessionManager.inMemory();
      const authStorage = AuthStorage.inMemory();
      yield* awaited(
        authStorage.modify("anthropic-api", () =>
          effectRunPromise(awaited({ key: "test-key", type: "api_key" as const })),
        ),
      );
      const session = new AgentSession({
        agent: new Agent({
          getApiKey: () => "test-key",
          initialState: {
            model,
            systemPrompt: "You are a helpful assistant.",
            thinkingLevel: "high",
            tools: [],
          },
          streamFn: streamSimple,
        }),
        cwd: process.cwd(),
        modelRuntime: getModelRuntime(yield* awaited(createInMemoryModelRegistry(authStorage))),
        resourceLoader: createTestResourceLoader(),
        sessionManager,
        settingsManager,
      });

      return yield* awaited({ session, sessionManager });
    }),
  );
}

function syncAgentMessages(
  session: codingAgentTypes.AgentSession,
  sessionManager: codingAgentTypes.SessionManager,
): void {
  session.agent.state.messages = sessionManager.buildSessionContext().messages;
}

const agentSessionStatsSupport = {
  createAssistantMessage,
  createSession,
  createUsage,
  createUserMessage,
  model,
  syncAgentMessages,
};

export default agentSessionStatsSupport;
