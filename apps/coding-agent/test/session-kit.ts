import agentModule from "@msa/agent-core";
import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import codingAgent from "../src/index.ts";
import type codingAgentTypes from "../src/index.types.ts";
import closeAgentSessionModule from "./close-agent-session.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
import type sessionKitTypes from "./session-kit.types.ts";
import utilities from "./utilities.ts";

const { AgentSession, SessionManager, SettingsManager } = codingAgent;

const { createAssistantMessageEventStream, getModel } = compat;

const { Agent } = agentModule;

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeTempDir,
  pollUntil,
  removePath,
  toJsonText,
  writeTextFile,
} = testing;
const { closeAgentSession } = closeAgentSessionModule;
const { createKeyedModelRuntime } = modelRuntimeTestUtils;
const { createTestExtensionsResult, createTestResourceLoader } = utilities;

type AssistantStream = ReturnType<typeof createAssistantMessageEventStream>;

const assistantMessage = (
  text: string,
  overrides: Partial<sessionKitTypes.AssistantMessage> = {},
): sessionKitTypes.AssistantMessage => ({
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
  ...overrides,
});

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter(
            (part): part is { type: "text"; text: string } =>
              typeof part === "object" && part !== null && part.type === "text",
          )
          .map((part) => part.text)
          .join("\n")
      : "";

const userTexts = (messages: readonly { role: string; content?: unknown }[]): string[] =>
  messages.filter((message) => message.role === "user").map((message) => textOf(message.content));

const reply = (stream: AssistantStream, message: sessionKitTypes.AssistantMessage): void => {
  stream.push({ partial: { ...message, content: [] }, type: "start" });
  stream.push({
    message,
    reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
    type: "done",
  });
};

const replyWhenAborted = (stream: AssistantStream, signal: AbortSignal | undefined): void => {
  stream.push({ partial: assistantMessage(""), type: "start" });
  Effect.runFork(
    pollUntil(
      Effect.sync(() => signal?.aborted === true),
      Number.MAX_SAFE_INTEGER,
      5,
    ).pipe(
      Effect.andThen(
        Effect.sync(() =>
          stream.push({ error: assistantMessage("Aborted"), reason: "aborted", type: "error" }),
        ),
      ),
    ),
  );
};

const streamWith =
  (respond: sessionKitTypes.Responder): sessionKitTypes.StreamFn =>
  (_model, context, options) => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => respond({ context, signal: options?.signal, stream }));
    return stream;
  };

const prepareWorkspace = Effect.fn("prepareWorkspace")(function* (prefix: string) {
  const dir = yield* makeTempDir(prefix);
  yield* writeTextFile(
    joinPath(dir, "settings.json"),
    yield* toJsonText({ memory: { enabled: false } }),
  );
  return dir;
});

const resourceLoaderFor = (
  options: sessionKitTypes.SessionOptions,
  extensionsResult: Awaited<ReturnType<typeof createTestExtensionsResult>> | undefined,
) =>
  createTestResourceLoader({
    ...(extensionsResult === undefined ? {} : { extensionsResult }),
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
  });

const createAgentSession = Effect.fn("createAgentSession")(function* (
  options: sessionKitTypes.SessionOptions,
) {
  const tools: sessionKitTypes.AgentTool[] = options.tools ?? options.agentTools ?? [];
  const agent = new Agent({
    getApiKey: () =>
      options.useTestKey === false ? options.apiKey : (options.apiKey ?? "test-key"),
    initialState: {
      model: getModel("anthropic-api", "claude-sonnet-4-5")!,
      systemPrompt: options.systemPrompt ?? "Test",
      tools,
    },
    streamFn: options.streamFn,
  });
  const sessionManager =
    options.persistSession === true
      ? SessionManager.create(options.cwd)
      : SessionManager.inMemory();
  const settingsManager = yield* Effect.promise(() =>
    SettingsManager.create(options.cwd, options.cwd),
  );
  const { modelRuntime } = yield* createKeyedModelRuntime(
    options.cwd,
    options.useTestKey === false ? undefined : "anthropic-api",
  );
  const extensionsResult =
    options.extensionFactories === undefined
      ? undefined
      : yield* awaited(createTestExtensionsResult(options.extensionFactories));
  const session = new AgentSession({
    agent,
    ...(options.tools === undefined
      ? {}
      : { baseToolsOverride: Object.fromEntries(options.tools.map((tool) => [tool.name, tool])) }),
    agentDir: options.cwd,
    cwd: options.cwd,
    modelRuntime,
    resourceLoader: resourceLoaderFor(options, extensionsResult),
    sessionManager,
    settingsManager,
  });
  return { agent, session, sessionManager, settingsManager };
});

const waitForStreaming = (session: codingAgentTypes.AgentSession): Effect.Effect<void> =>
  pollUntil(
    Effect.sync(() => session.isStreaming),
    1000,
    5,
  );

const disposeWorkspace = (
  session: codingAgentTypes.AgentSession | undefined,
  dir: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (session !== undefined) yield* awaited(closeAgentSession(session));
    if (dir.length > 0) yield* removePath(dir);
  });

const sessionKit = {
  assistantMessage,
  closeAgentSession,
  createAgentSession,
  disposeWorkspace,
  prepareWorkspace,
  reply,
  replyWhenAborted,
  streamWith,
  textOf,
  userTexts,
  waitForStreaming,
};

export default sessionKit;
