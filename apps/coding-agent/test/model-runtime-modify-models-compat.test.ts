import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

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
  runTest,
  currentTimeMillis,
  toJsonText,
  writeTextFile,
  removePath,
  joinPath,
} from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
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

describe("extension provider model lifecycle", () => {
  it("registers native msa-ai providers with their auth implementation", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsStore: new InMemoryModelsStore(),
            modelsPath: null,
            allowModelNetwork: false,
          }),
        );
        const nativeModel = {
          ...model("native"),
          provider: "extension-native",
          baseUrl: "https://fallback.test/v1",
        };
        const provider: Provider = {
          id: "extension-native",
          name: "Extension Native",
          auth: {
            apiKey: {
              name: "Native setup",
              login: (interaction) =>
                effectRunPromise(
                  Effect.gen(function* () {
                    return {
                      type: "api_key" as const,
                      key: yield* awaited(
                        interaction.prompt({ type: "secret" as const, message: "API key" }),
                      ),
                    };
                  }),
                ),
              check: ({ credential }) =>
                effectRunPromise(
                  awaited(
                    credential?.key !== undefined && credential?.key.length > 0
                      ? { type: "api_key" as const, source: "stored native key" }
                      : undefined,
                  ),
                ),
              resolve: ({ credential }) =>
                effectRunPromise(
                  awaited(
                    credential?.key !== undefined && credential?.key.length > 0
                      ? {
                          auth: { apiKey: credential.key, baseUrl: "https://resolved.test/v1" },
                          source: "stored native key",
                        }
                      : undefined,
                  ),
                ),
            },
          },
          getModels: () => [nativeModel],
          stream: () => {
            throw new Error("unused");
          },
          streamSimple: () => {
            throw new Error("unused");
          },
        };

        runtime.registerNativeProvider(provider);
        const registry = new ModelRegistry(runtime);
        expect(registry.getProvider("extension-native")).toBe(provider);
        expect(registry.getRegisteredNativeProvider("extension-native")).toBe(provider);
        expect(registry.getRegisteredProviderIds()).toContain("extension-native");
        expect(registry.find("extension-native", "native")).toBeDefined();

        yield* awaited(
          runtime.login("extension-native", "api_key", {
            prompt: () => effectRunPromise(awaited("secret")),
            notify: () => {},
          }),
        );
        expect(yield* awaited(registry.getProviderAuth("extension-native"))).toMatchObject({
          auth: { apiKey: "secret", baseUrl: "https://resolved.test/v1" },
        });

        registry.unregisterProvider("extension-native");
        expect(registry.getProvider("extension-native")).toBeUndefined();
      }),
    ));

  it("marks a native provider with a stored credential as configured when it registers", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory({
              "extension-native": {
                type: "oauth" as const,
                access: "access",
                refresh: "refresh",
                expires: currentTimeMillis() + 3_600_000,
              },
            }),
            modelsStore: new InMemoryModelsStore(),
            modelsPath: null,
            allowModelNetwork: false,
          }),
        );
        const nativeModel = { ...model("native"), provider: "extension-native" };
        const unused = () => {
          throw new Error("unused");
        };
        const provider: Provider = {
          id: "extension-native",
          name: "Extension Native",
          auth: {
            oauth: {
              name: "Native OAuth",
              login: unused,
              refresh: (credential) => effectRunPromise(awaited(credential)),
              toAuth: (credential) => effectRunPromise(awaited({ apiKey: credential.access })),
            },
          },
          getModels: () => [nativeModel],
          stream: unused,
          streamSimple: unused,
        };

        runtime.registerNativeProvider(provider);

        expect(runtime.hasConfiguredAuth("extension-native")).toBe(true);
        expect(runtime.isUsingOAuth("extension-native")).toBe(true);
        expect(runtime.getAvailableSnapshot().map((m) => `${m.provider}/${m.id}`)).toContain(
          "extension-native/native",
        );
        yield* awaited(runtime.refresh({ allowNetwork: false }));
        expect(runtime.hasConfiguredAuth("extension-native")).toBe(true);
      }),
    ));

  it("preserves native deferred methods through provider overlays", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const tempDir = mkdtempSync(joinPath(tmpdir(), "msa-native-provider-deferred-"));
        const modelsPath = joinPath(tempDir, "models.json");
        yield* writeTextFile(
          modelsPath,
          yield* toJsonText({
            providers: {
              "extension-native-deferred": { baseUrl: "https://overlay.test/v1" },
            },
          }),
        );
        try {
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

  it("applies models.json overrides above native providers", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const tempDir = mkdtempSync(joinPath(tmpdir(), "msa-native-provider-"));
        const modelsPath = joinPath(tempDir, "models.json");
        yield* writeTextFile(
          modelsPath,
          yield* toJsonText({
            providers: {
              "extension-native": {
                modelOverrides: {
                  native: { contextWindow: 4242 },
                },
              },
            },
          }),
        );
        try {
          const runtime = yield* awaited(
            ModelRuntime.create({
              credentials: AuthStorage.inMemory(),
              modelsStore: new InMemoryModelsStore(),
              modelsPath,
              allowModelNetwork: false,
            }),
          );
          const nativeModel = {
            ...model("native"),
            provider: "extension-native",
            baseUrl: "https://native.test/v1",
          };
          runtime.registerNativeProvider({
            id: "extension-native",
            name: "Extension Native",
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
          });

          expect(runtime.getModel("extension-native", "native")?.contextWindow).toBe(4242);
        } finally {
          yield* removePath(tempDir);
        }
      }),
    ));

  it("publishes refreshModels results without forcing ModelsStore persistence", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const modelsStore = new InMemoryModelsStore();
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsStore,
            modelsPath: null,
            allowModelNetwork: false,
          }),
        );
        runtime.registerProvider("extension-dynamic", {
          baseUrl: "http://localhost:8080/v1",
          apiKey: "local",
          api: "openai-completions" as const,
          refreshModels: () =>
            effectRunPromise(
              awaited([
                {
                  ...model("live"),
                  provider: "extension-dynamic",
                  baseUrl: "http://localhost:8080/v1",
                },
              ]),
            ),
        });

        yield* awaited(runtime.refresh({ allowNetwork: false }));
        expect(runtime.getModel("extension-dynamic", "live")).toBeDefined();
        expect(yield* awaited(modelsStore.read("extension-dynamic"))).toBeUndefined();
      }),
    ));

  it("applies legacy OAuth modifyModels after async credential initialization", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory({
              "extension-oauth": {
                type: "oauth" as const,
                access: "access",
                refresh: "refresh",
                expires: currentTimeMillis() + 60_000,
              },
            }),
            modelsStore: new InMemoryModelsStore(),
            modelsPath: null,
            allowModelNetwork: false,
          }),
        );
        runtime.registerProvider("extension-oauth", {
          baseUrl: "https://example.test/v1",
          api: "openai-completions" as const,
          models: [model("base")],
          oauth: {
            name: "Extension OAuth",
            login: () =>
              effectRunPromise(
                Effect.sync(() => {
                  throw new Error("not used");
                }),
              ),
            refreshToken: (credential) => effectRunPromise(awaited(credential)),
            getApiKey: (credential) => credential.access,
            modifyModels: (models, credential) =>
              credential.access === "access" ? [...models, model("credential-model")] : models,
          },
        });

        yield* awaited(runtime.refresh({ allowNetwork: false }));
        expect(runtime.getModel("extension-oauth", "base")).toBeDefined();
        expect(runtime.getModel("extension-oauth", "credential-model")).toBeDefined();

        yield* awaited(runtime.logout("extension-oauth"));
        expect(runtime.getModel("extension-oauth", "credential-model")).toBeUndefined();
      }),
    ));
});
