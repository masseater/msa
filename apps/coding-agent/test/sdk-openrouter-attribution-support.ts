import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import AuthStorage from "../src/core/auth-storage.ts";
import sdk from "../src/core/sdk.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
import type sdkOpenrouterAttributionSupportTypes from "./sdk-openrouter-attribution-support.types.ts";
const { createAgentSession } = sdk;

const { createAssistantMessageEventStream, normalizeContext } = ai;

const { awaited, currentTimeMillis, joinPath, makeDirectory, makeTempDir, removePath, runTest } =
  testing;

const { createInMemoryModelRegistry, getModelRuntime } = modelRuntimeTestUtils;

const dirs = { agentDir: "", cwd: "", tempDir: "" };

const prepareDirs = Effect.gen(function* () {
  dirs.tempDir = yield* makeTempDir("pi-sdk-attribution-test-");
  dirs.cwd = joinPath(dirs.tempDir, "project");
  dirs.agentDir = joinPath(dirs.tempDir, "agent");
  yield* makeDirectory(dirs.cwd);
  yield* makeDirectory(dirs.agentDir);
});

const cleanupDirs = Effect.suspend(() =>
  dirs.tempDir === "" ? Effect.void : removePath(dirs.tempDir),
);

function createModel(
  provider: string,
  baseUrl: string,
  id = `${provider}-test-model`,
): aiTypes.Model<aiTypes.Api> {
  return {
    api: "openai-completions" as const,
    baseUrl,
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 4096,
    name: `${provider} Test Model`,
    provider,
    reasoning: false,
  };
}

function createDoneStream() {
  const stream = createAssistantMessageEventStream();
  const message: aiTypes.AssistantMessage = {
    api: "openai-completions" as const,
    content: [{ text: "ok", type: "text" as const }],
    model: "capture-model",
    provider: "capture-provider",
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
  };
  stream.end(message);
  return stream;
}

const settingsFor = (options: sdkOpenrouterAttributionSupportTypes.CaptureOptions) =>
  Effect.gen(function* () {
    const settingsManager = yield* Effect.promise(() =>
      SettingsManager.create(dirs.cwd, dirs.agentDir),
    );
    if (options.telemetryEnabled === false)
      settingsManager.telemetry.setEnableInstallTelemetry(false);
    return settingsManager;
  });

const sessionManagerFor = (options: sdkOpenrouterAttributionSupportTypes.CaptureOptions) => {
  const sessionManager = SessionManager.inMemory(dirs.cwd);
  if (options.sessionId !== undefined && options.sessionId.length > 0) {
    sessionManager.newSession({ id: options.sessionId });
  }
  return sessionManager;
};

const capturingRegistry = Effect.fn("capturingRegistry")(function* (
  model: aiTypes.Model<aiTypes.Api>,
  options: sdkOpenrouterAttributionSupportTypes.CaptureOptions,
  capture: { options?: aiTypes.SimpleStreamOptions | undefined },
) {
  const authStorage = AuthStorage.inMemory({
    [model.provider]: { key: "test-api-key", type: "api_key" as const },
  });
  const modelRegistry = yield* awaited(createInMemoryModelRegistry(authStorage));
  modelRegistry.registerProvider(model.provider, {
    api: model.api,
    ...(options.providerHeaders === undefined ? {} : { headers: options.providerHeaders }),
    streamSimple: (_model, _context, providerOptions) => {
      capture.options = providerOptions;
      return createDoneStream();
    },
  });
  return modelRegistry;
});

const captureHeaders = (
  model: aiTypes.Model<aiTypes.Api>,
  options: sdkOpenrouterAttributionSupportTypes.CaptureOptions = {},
): Promise<aiTypes.ProviderHeaders | undefined> =>
  runTest(
    Effect.gen(function* () {
      const capture: { options?: aiTypes.SimpleStreamOptions | undefined } = {};
      const modelRegistry = yield* capturingRegistry(model, options, capture);
      const { session } = yield* awaited(
        createAgentSession({
          agentDir: dirs.agentDir,
          cwd: dirs.cwd,
          model,
          modelRuntime: getModelRuntime(modelRegistry),
          sessionManager: sessionManagerFor(options),
          settingsManager: yield* settingsFor(options),
        }),
      );
      const request = Effect.flatMap(
        awaited(
          session.agent.streamFunction(model, normalizeContext({ messages: [] }), {
            sessionId: session.sessionId,
            ...(options.requestHeaders === undefined ? {} : { headers: options.requestHeaders }),
          }),
        ),
        (stream) => awaited(stream.result()),
      );
      yield* request.pipe(
        Effect.ensuring(
          Effect.andThen(
            Effect.sync(() => modelRegistry.unregisterProvider(model.provider)),
            awaited(session.dispose()),
          ),
        ),
      );
      return capture.options?.headers;
    }),
  );

const sdkOpenrouterAttributionSupport = {
  captureHeaders,
  cleanupDirs,
  createDoneStream,
  createModel,
  dirs,
  prepareDirs,
};

export default sdkOpenrouterAttributionSupport;
