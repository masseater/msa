import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import ModelRuntime from "../src/core/model-runtime.ts";
import type modelRuntimeTypes from "../src/core/model-runtime.types.ts";
const { InMemoryModelsStore, createAssistantMessageEventStream } = ai;

const { awaited, joinPath, makeTempDir, removePath, runTest, toJsonText, writeTextFile } = testing;

function model(id: string): aiTypes.Model<"openai-completions"> {
  return {
    api: "openai-completions" as const,
    baseUrl: "https://example.test/v1",
    contextWindow: 1000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 100,
    name: id,
    provider: "extension-oauth",
    reasoning: false,
  };
}

const writeModels = (dir: string, value: unknown): Effect.Effect<string> =>
  Effect.gen(function* () {
    const modelsPath = joinPath(dir, "models.json");
    yield* writeTextFile(modelsPath, yield* toJsonText(value));
    return modelsPath;
  });

type Observed = {
  cancelledId?: string;
  cancelledOptions?: aiTypes.DeferredCancelOptions | undefined;
  fetchedBaseUrl?: string;
  fetchedOptions?: aiTypes.DeferredFetchOptions | undefined;
};

const finishedStream = (requestModel: aiTypes.Model<"openai-completions">) => {
  const message = {
    api: requestModel.api,
    content: [],
    model: requestModel.id,
    provider: requestModel.provider,
    role: "assistant" as const,
    stopReason: "stop" as const,
    timestamp: 0,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ partial: message, type: "start" as const });
  stream.push({ message, reason: "stop", type: "done" as const });
  stream.end(message);
  return stream;
};

const deferredProvider = (
  nativeModel: aiTypes.Model<"openai-completions">,
  observed: Observed,
): aiTypes.Provider => ({
  auth: {
    apiKey: {
      name: "Native key",
      resolve: () => Promise.resolve({ auth: { apiKey: "key" }, source: "native" }),
    },
  },
  cancelDeferred: (_requestModel, handle, options) => {
    observed.cancelledId = handle.id;
    observed.cancelledOptions = options;
    return Promise.resolve();
  },
  fetchDeferred: (requestModel, _handle, options) => {
    observed.fetchedBaseUrl = requestModel.baseUrl;
    observed.fetchedOptions = options;
    return finishedStream(requestModel as aiTypes.Model<"openai-completions">);
  },
  getModels: () => [nativeModel],
  id: "extension-native-deferred",
  name: "Extension Native Deferred",
  stream: () => {
    throw new Error("unused");
  },
  streamSimple: () => {
    throw new Error("unused");
  },
});

const fetchThenCancel = (
  runtime: modelRuntimeTypes.ModelRuntime,
  providerId: string,
  modelId: string,
) =>
  Effect.gen(function* () {
    const composedModel = runtime.getModel(providerId, modelId);
    expect(composedModel).toBeDefined();
    const handle = (id: string) => ({ api: composedModel!.api, id, modelId, provider: providerId });
    yield* awaited(
      runtime.fetchDeferred(composedModel!, handle("fetch-id"), {
        headers: { "X-Fetch": "fetch" },
        transformHeaders: (headers) => ({ ...headers, "X-Transformed": "fetch" }),
        wait: 25,
      }),
    );
    yield* awaited(
      runtime.cancelDeferred(composedModel!, handle("cancel-id"), {
        timeoutMs: 100,
        transformHeaders: (headers) => ({ ...headers, "X-Transformed": "cancel" }),
      }),
    );
  });

const preservesNativeDeferredMethodsThroughProviderOverlays = Effect.gen(function* () {
  const tempDir = yield* makeTempDir("msa-native-provider-deferred-");
  try {
    const modelsPath = yield* writeModels(tempDir, {
      providers: { "extension-native-deferred": { baseUrl: "https://overlay.test/v1" } },
    });
    const runtime = yield* awaited(
      ModelRuntime.create({
        allowModelNetwork: false,
        credentials: AuthStorage.inMemory(),
        modelsPath,
        modelsStore: new InMemoryModelsStore(),
      }),
    );
    const nativeModel = {
      ...model("native-deferred"),
      baseUrl: "https://native.test/v1",
      provider: "extension-native-deferred",
    };
    const observed: Observed = {};
    const provider = deferredProvider(nativeModel, observed);
    runtime.registerNativeProvider(provider);
    yield* fetchThenCancel(runtime, provider.id, nativeModel.id);

    expect(observed.fetchedBaseUrl).toBe("https://overlay.test/v1");
    expect(observed.fetchedOptions).toMatchObject({
      apiKey: "key",
      headers: { "X-Fetch": "fetch", "X-Transformed": "fetch" },
      wait: 25,
    });
    expect(observed.cancelledId).toBe("cancel-id");
    expect(observed.cancelledOptions).toMatchObject({
      apiKey: "key",
      headers: { "X-Transformed": "cancel" },
      timeoutMs: 100,
    });
  } finally {
    yield* removePath(tempDir);
  }
});

describe("extension provider model lifecycle", () => {
  it("preserves native deferred methods through provider overlays", () =>
    runTest(preservesNativeDeferredMethodsThroughProviderOverlays));
});
