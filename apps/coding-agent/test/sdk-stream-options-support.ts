import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import AuthStorage from "../src/core/auth-storage.ts";
import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import codingAgent from "../src/index.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createAgentSession } = codingAgent;

const { DefaultResourceLoader, SessionManager, SettingsManager } = codingAgent;
const { createAssistantMessageEventStream, normalizeContext } = ai;

const { awaited, currentTimeMillis, joinPath, makeDirectory, makeTempDir, removePath, runTest } =
  testing;

const { createModelRegistry, getModelRuntime } = modelRuntimeTestUtils;

const dirs = { agentDir: "", cwd: "", tempDir: "" };

const prepareDirs = () =>
  runTest(
    Effect.gen(function* () {
      dirs.tempDir = yield* makeTempDir("msa-sdk-stream-options-");
      dirs.cwd = joinPath(dirs.tempDir, "project");
      dirs.agentDir = joinPath(dirs.tempDir, "agent");
      yield* makeDirectory(dirs.cwd);
      yield* makeDirectory(dirs.agentDir);
    }),
  );

const cleanupDirs = () => runTest(dirs.tempDir === "" ? Effect.void : removePath(dirs.tempDir));

const createModel = (api: aiTypes.Api): aiTypes.Model<aiTypes.Api> => ({
  api,
  baseUrl: "https://capture.invalid/v1",
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  headers: { "x-model": "model" },
  id: "capture-model",
  input: ["text"],
  maxTokens: 4096,
  name: "Capture Model",
  provider: "capture-provider",
  reasoning: false,
});

const createDoneMessage = (api: aiTypes.Api, promptTokens = 0): aiTypes.AssistantMessage => ({
  api,
  content: [{ text: "ok", type: "text" as const }],
  model: "capture-model",
  provider: "capture-provider",
  role: "assistant",
  stopReason: "stop",
  timestamp: currentTimeMillis(),
  usage: {
    cacheRead: promptTokens,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: promptTokens,
  },
});

const createDoneStream = (api: aiTypes.Api, promptTokens = 0) => {
  const stream = createAssistantMessageEventStream();
  stream.end(createDoneMessage(api, promptTokens));
  return stream;
};

const registryWithKey = Effect.fn("registryWithKey")(function* (provider: string) {
  const authStorage = AuthStorage.create(joinPath(dirs.agentDir, "auth.json"));
  yield* awaited(
    authStorage.modify(provider, () =>
      Promise.resolve({ key: "test-api-key", type: "api_key" as const }),
    ),
  );
  return yield* awaited(createModelRegistry(authStorage, joinPath(dirs.agentDir, "models.json")));
});

const capturingProvider = (
  api: aiTypes.Api,
  providerEvent: unknown,
  capture: { options?: aiTypes.SimpleStreamOptions | undefined },
) => ({
  api,
  headers: { "x-provider": "provider" },
  streamSimple: (
    requestModel: aiTypes.Model<aiTypes.Api>,
    _context: unknown,
    options?: aiTypes.SimpleStreamOptions,
  ) => {
    capture.options = options;
    if (providerEvent === undefined) return createDoneStream(api);
    const stream = createAssistantMessageEventStream();
    Effect.runFork(
      Effect.gen(function* () {
        yield* awaited(options?.onProviderStreamEvent?.(providerEvent, requestModel));
        stream.end(createDoneMessage(api));
      }),
    );
    return stream;
  },
});

const loadResources = Effect.fn("loadResources")(function* (
  settingsManager: settingsManagerTypes.SettingsManager,
  extensionFactory: extensionsTypesTypes.ExtensionFactory | undefined,
) {
  const resourceLoader = new DefaultResourceLoader({
    agentDir: dirs.agentDir,
    cwd: dirs.cwd,
    extensionFactories: extensionFactory === undefined ? [] : [extensionFactory],
    settingsManager,
  });
  yield* awaited(resourceLoader.reload());
  return resourceLoader;
});

const captureStreamOptions = (
  api: aiTypes.Api,
  settings: Partial<settingsManagerTypes.Settings>,
  requestOptions: aiTypes.SimpleStreamOptions = {},
  extensionFactory?: extensionsTypesTypes.ExtensionFactory,
  providerEvent?: unknown,
): Promise<aiTypes.SimpleStreamOptions | undefined> =>
  runTest(
    Effect.gen(function* () {
      const model = createModel(api);
      const settingsManager = SettingsManager.inMemory(settings);
      const resourceLoader = yield* loadResources(settingsManager, extensionFactory);
      const registry = yield* registryWithKey(model.provider);
      const capture: { options?: aiTypes.SimpleStreamOptions | undefined } = {};
      registry.registerProvider(model.provider, capturingProvider(api, providerEvent, capture));
      const { session } = yield* awaited(
        createAgentSession({
          agentDir: dirs.agentDir,
          cwd: dirs.cwd,
          model,
          modelRuntime: getModelRuntime(registry),
          resourceLoader,
          sessionManager: SessionManager.inMemory(dirs.cwd),
          settingsManager,
        }),
      );
      const request =
        providerEvent === undefined
          ? Effect.flatMap(
              awaited(
                session.agent.streamFunction(
                  model,
                  normalizeContext({ messages: [] }),
                  requestOptions,
                ),
              ),
              (stream) => awaited(stream.result()),
            )
          : awaited(session.run.prompting.prompt("test"));
      yield* request.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            session.dispose();
            registry.unregisterProvider(model.provider);
          }),
        ),
      );
      return capture.options;
    }),
  );

const cacheWarmingModel = (): aiTypes.Model<aiTypes.Api> => ({
  ...createModel("anthropic-messages"),
  cost: { cacheRead: 0.25, cacheWrite: 12.5, input: 10, output: 50 },
  promptCache: { short: 300 },
});

const createCacheWarmingSession = (
  populate?: (
    manager: sessionManagerTypes.SessionManager,
    model: aiTypes.Model<aiTypes.Api>,
  ) => void,
) =>
  runTest(
    Effect.gen(function* () {
      const model = cacheWarmingModel();
      const registry = yield* registryWithKey(model.provider);
      let providerCalls = 0;
      registry.registerProvider(model.provider, {
        api: model.api,
        streamSimple: () => {
          providerCalls++;
          return createDoneStream(model.api, 100_000);
        },
      });
      const sessionManager = SessionManager.inMemory(dirs.cwd);
      populate?.(sessionManager, model);
      const { session } = yield* awaited(
        createAgentSession({
          agentDir: dirs.agentDir,
          cwd: dirs.cwd,
          model,
          modelRuntime: getModelRuntime(registry),
          sessionManager,
          settingsManager: SettingsManager.inMemory({ cacheWarming: "idle" }),
        }),
      );
      const dispose = () => {
        session.dispose();
        registry.unregisterProvider(model.provider);
      };
      return { dispose, providerCalls: () => providerCalls, session };
    }),
  );

const sdkStreamOptionsSupport = {
  captureStreamOptions,
  cleanupDirs,
  createCacheWarmingSession,
  createDoneMessage,
  createDoneStream,
  createModel,
  prepareDirs,
};

export default sdkStreamOptionsSupport;
