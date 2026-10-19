import {
  createAssistantMessageEventStream,
  type DeferredCancelOptions,
  type DeferredFetchOptions,
  InMemoryModelsStore,
  type Model,
  type Provider,
} from "@msa/ai";
import {
  awaited,
  joinPath,
  makeTempDir,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

function model(id: string): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions" as const,
    provider: "extension-oauth",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

const writeModels = (dir: string, value: unknown): Effect.Effect<string> =>
  Effect.gen(function* () {
    const modelsPath = joinPath(dir, "models.json");
    yield* writeTextFile(modelsPath, yield* toJsonText(value));
    return modelsPath;
  });

describe("extension provider model lifecycle", () => {
  it("preserves native deferred methods through provider overlays", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const tempDir = yield* makeTempDir("msa-native-provider-deferred-");
        try {
          const modelsPath = yield* writeModels(tempDir, {
            providers: {
              "extension-native-deferred": { baseUrl: "https://overlay.test/v1" },
            },
          });
          const runtime = yield* awaited(
            ModelRuntime.create({
              credentials: AuthStorage.inMemory(),
              modelsStore: new InMemoryModelsStore(),
              modelsPath,
              allowModelNetwork: false,
            }),
          );
          const nativeModel = {
            ...model("native-deferred"),
            provider: "extension-native-deferred",
            baseUrl: "https://native.test/v1",
          };
          let fetchedBaseUrl: string | undefined;
          let fetchedOptions: DeferredFetchOptions | undefined;
          let cancelledId: string | undefined;
          let cancelledOptions: DeferredCancelOptions | undefined;
          const provider: Provider = {
            id: "extension-native-deferred",
            name: "Extension Native Deferred",
            auth: {
              apiKey: {
                name: "Native key",
                resolve: () =>
                  effectRunPromise(awaited({ auth: { apiKey: "key" }, source: "native" })),
              },
            },
            getModels: () => [nativeModel],
            stream: () => {
              throw new Error("unused");
            },
            streamSimple: () => {
              throw new Error("unused");
            },
            fetchDeferred: (requestModel, _handle, options) => {
              fetchedBaseUrl = requestModel.baseUrl;
              fetchedOptions = options;
              const message = {
                role: "assistant" as const,
                content: [],
                api: requestModel.api,
                provider: requestModel.provider,
                model: requestModel.id,
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
                stopReason: "stop" as const,
                timestamp: 0,
              };
              const stream = createAssistantMessageEventStream();
              stream.push({ type: "start" as const, partial: message });
              stream.push({ type: "done" as const, reason: "stop", message });
              stream.end(message);
              return stream;
            },
            cancelDeferred: (_requestModel, handle, options) =>
              effectRunPromise(
                Effect.sync(() => {
                  cancelledId = handle.id;
                  cancelledOptions = options;
                }),
              ),
          };

          runtime.registerNativeProvider(provider);
          const composedModel = runtime.getModel(provider.id, nativeModel.id);
          expect(composedModel).toBeDefined();

          yield* awaited(
            runtime.fetchDeferred(
              composedModel!,
              {
                provider: provider.id,
                modelId: nativeModel.id,
                api: nativeModel.api,
                id: "fetch-id",
              },
              {
                wait: 25,
                headers: { "X-Fetch": "fetch" },
                transformHeaders: (headers) => ({ ...headers, "X-Transformed": "fetch" }),
              },
            ),
          );
          yield* awaited(
            runtime.cancelDeferred(
              composedModel!,
              {
                provider: provider.id,
                modelId: nativeModel.id,
                api: nativeModel.api,
                id: "cancel-id",
              },
              {
                timeoutMs: 100,
                transformHeaders: (headers) => ({ ...headers, "X-Transformed": "cancel" }),
              },
            ),
          );

          expect(fetchedBaseUrl).toBe("https://overlay.test/v1");
          expect(fetchedOptions).toMatchObject({
            apiKey: "key",
            wait: 25,
            headers: { "X-Fetch": "fetch", "X-Transformed": "fetch" },
          });
          expect(cancelledId).toBe("cancel-id");
          expect(cancelledOptions).toMatchObject({
            apiKey: "key",
            timeoutMs: 100,
            headers: { "X-Transformed": "cancel" },
          });
        } finally {
          yield* removePath(tempDir);
        }
      }),
    ));
});
