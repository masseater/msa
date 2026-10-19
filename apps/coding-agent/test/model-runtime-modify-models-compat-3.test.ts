import { InMemoryModelsStore, type Model } from "@msa/ai";
import {
  awaited,
  currentTimeMillis,
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
  it("applies models.json overrides above native providers", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const tempDir = yield* makeTempDir("msa-native-provider-");
        try {
          const modelsPath = yield* writeModels(tempDir, {
            providers: {
              "extension-native": {
                modelOverrides: {
                  native: { contextWindow: 4242 },
                },
              },
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
