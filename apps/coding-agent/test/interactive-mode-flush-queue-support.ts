import agentModule from "@msa/agent-core";
import type agentTypes from "@msa/agent-core/index.types";
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

const { createAssistantMessageEventStream, getModel } = compat;

const { Agent } = agentModule;

const { awaited, currentTimeMillis, gate, joinPath, pollUntil, runTest } = testing;
const { createModelRegistry, getModelRuntime } = modelRuntimeTestUtils;
const { createTestResourceLoader } = utilities;

type SubmitHandler = (text: string) => unknown;

type QueueEvent = { steering: readonly string[]; followUp: readonly string[] };

const createAssistantMessage = (text: string): compatTypes.AssistantMessage => ({
  api: "anthropic-messages",
  content: [{ text, type: "text" }],
  model: "mock",
  provider: "anthropic-api",
  role: "assistant",
  stopReason: "stop",
  timestamp: currentTimeMillis(),
  usage: {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: 0,
  },
});

const textParts = (content: readonly { type: string; text?: string }[]): string[] =>
  content.flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : []));

const userTexts = (messages: readonly { role: string; content: unknown }[]): string[] =>
  messages.flatMap((message) => {
    if (message.role !== "user") return [];
    if (typeof message.content === "string") return [message.content];
    return Array.isArray(message.content) ? textParts(message.content) : [];
  });

const createAgent = (requests: string[][], firstReply: Promise<void>): agentTypes.Agent =>
  new Agent({
    getApiKey: () => "test-key",
    initialState: {
      model: getModel("anthropic-api", "claude-sonnet-4-5")!,
      systemPrompt: "Test",
      tools: [],
    },
    streamFn: (_model, context) => {
      requests.push(userTexts(context.messages));
      const stream = createAssistantMessageEventStream();
      const finish = () =>
        stream.push({ message: createAssistantMessage("ok"), reason: "stop", type: "done" });
      if (requests.length === 1) void firstReply.then(finish);
      else queueMicrotask(finish);
      return stream;
    },
  });

const createSession = Effect.fn("createSession")(function* (
  tempDir: string,
  agent: agentTypes.Agent,
) {
  const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
  const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));
  yield* awaited(
    authStorage.modify("anthropic-api", () =>
      runTest(Effect.succeed({ key: "test-key", type: "api_key" as const })),
    ),
  );
  return new AgentSession({
    agent,
    cwd: tempDir,
    modelRuntime: getModelRuntime(modelRegistry),
    resourceLoader: createTestResourceLoader(),
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.create(tempDir, tempDir),
  });
});

const collectQueueEvents = (session: codingAgentTypes.AgentSession): QueueEvent[] => {
  const queueEvents: QueueEvent[] = [];
  session.subscribe((event: codingAgentTypes.AgentSessionEvent) => {
    if (event.type === "queue_update") {
      queueEvents.push({ followUp: event.followUp, steering: event.steering });
    }
  });
  return queueEvents;
};

const createHarness = Effect.fn("createHarness")(function* (
  tempDir: string,
  setClock: (at: number) => void,
  attachSubmitHandler: (
    session: codingAgentTypes.AgentSession,
    statuses: string[],
  ) => SubmitHandler,
) {
  const requests: string[][] = [];
  const firstReply = gate();
  const session = yield* createSession(tempDir, createAgent(requests, firstReply));
  const queueEvents = collectQueueEvents(session);
  const statuses: string[] = [];
  const onSubmit = attachSubmitHandler(session, statuses);
  const firstRun = session.run.prompting.prompt("start");
  yield* pollUntil(
    Effect.sync(() => session.isStreaming),
    1000,
    5,
  );
  const pressEnter = (text: string, at: number) =>
    Effect.gen(function* () {
      setClock(at);
      yield* awaited(onSubmit(text));
    });
  return {
    firstRun,
    pressEnter,
    queueEvents,
    release: firstReply.release,
    requests,
    session,
    statuses,
  };
});

const interactiveModeFlushQueueSupport = {
  createHarness,
};

export default interactiveModeFlushQueueSupport;
