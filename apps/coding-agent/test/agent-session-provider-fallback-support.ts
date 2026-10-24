import agentModule from "@msa/agent-core";
import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import messagesModule from "../src/core/messages.ts";
import codingAgent from "../src/index.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
import sessionKit from "./session-kit.ts";
import utilities from "./utilities.ts";

const { AgentSession, SessionManager, SettingsManager } = codingAgent;
const { Agent } = agentModule;
const { convertToLlm } = messagesModule;
const { createAssistantMessageEventStream } = compat;
const { awaited, runTest } = testing;
const { createKeyedModelRuntime } = modelRuntimeTestUtils;
const { assistantMessage } = sessionKit;
const { createTestResourceLoader } = utilities;

const CREDITS_ERROR =
  '402: {"message":"This request requires more credits, or fewer max_tokens.","code":402}';

const providerStream = (failing: ReadonlySet<string>) => {
  const calls: string[] = [];
  const contexts: agentTypes.AgentContext[] = [];
  const streamFn: agentTypes.StreamFn = (model, context) => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      contexts.push(context as agentTypes.AgentContext);
      calls.push(model.provider);
      const base = { model: model.id, provider: model.provider };
      if (failing.has(model.provider)) {
        const error = assistantMessage("", {
          ...base,
          errorMessage: CREDITS_ERROR,
          stopReason: "error",
        });
        stream.push({ partial: error, type: "start" });
        stream.push({ error, reason: "error", type: "error" });
        return;
      }
      const message = assistantMessage(`answered by ${model.provider}`, base);
      stream.push({ partial: message, type: "start" });
      stream.push({ message, reason: "stop", type: "done" });
    });
    return stream;
  };
  return { calls, contexts, streamFn };
};

const recordEvents = (session: InstanceType<typeof AgentSession>): string[] => {
  const events: string[] = [];
  session.subscribe((event) => {
    if (event.type === "model_fallback") events.push(`fallback:${event.from}->${event.to}`);
    if (event.type === "provider_stalled") events.push(`stalled:${event.model}`);
    if (event.type === "provider_recovered") events.push(`recovered:${event.model}`);
    if (event.type === "auto_retry_start") events.push("retry");
  });
  return events;
};

const startFallbackSession = Effect.fn("startFallbackSession")(function* (
  cwd: string,
  stream: ReturnType<typeof providerStream>,
  scoped: <M>(models: { openrouter: M; anthropic: M }) => M[],
) {
  const { authStorage, modelRuntime } = yield* createKeyedModelRuntime(cwd, "anthropic-api");
  yield* awaited(
    authStorage.modify("openrouter", () =>
      runTest(Effect.succeed({ key: "test-key", type: "api_key" as const })),
    ),
  );
  const openrouter = modelRuntime.getModels("openrouter")[0]!;
  const anthropic = modelRuntime.getModels("anthropic-api")[0]!;
  const agent = new Agent({
    convertToLlm,
    getApiKey: () => "test-key",
    initialState: { model: openrouter, systemPrompt: "Test", tools: [] },
    streamFn: stream.streamFn,
  });
  const settingsManager = yield* Effect.promise(() => SettingsManager.create(cwd, cwd));
  settingsManager.applyOverrides({ retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } });
  const session = new AgentSession({
    agent,
    cwd,
    modelRuntime,
    resourceLoader: createTestResourceLoader(),
    scopedModels: scoped({ anthropic, openrouter }).map((model) => ({ model })),
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });
  return { anthropic, events: recordEvents(session), openrouter, session };
});

const agentSessionProviderFallbackSupport = {
  CREDITS_ERROR,
  providerStream,
  startFallbackSession,
};

export default agentSessionProviderFallbackSupport;
