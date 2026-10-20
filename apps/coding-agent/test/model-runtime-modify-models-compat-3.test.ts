import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import ModelRuntime from "../src/core/model-runtime.ts";

const { InMemoryModelsStore } = ai;

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeTempDir,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

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

const appliesModelsJsonOverridesAboveNativeProvidersPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const tempDir = yield* makeTempDir("msa-native-provider-");
    return { effectRunPromise, tempDir };
  });

const appliesModelsJsonOverridesAboveNativeProviders = Effect.gen(function* () {
  const { effectRunPromise, tempDir } =
    yield* appliesModelsJsonOverridesAboveNativeProvidersPart1();
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
        allowModelNetwork: false,
        credentials: AuthStorage.inMemory(),
        modelsPath,
        modelsStore: new InMemoryModelsStore(),
      }),
    );
    const nativeModel = {
      ...model("native"),
      baseUrl: "https://native.test/v1",
      provider: "extension-native",
    };
    runtime.registerNativeProvider({
      auth: {
        apiKey: {
          name: "Native key",
          resolve: () => effectRunPromise(awaited({ auth: { apiKey: "key" }, source: "native" })),
        },
      },
      getModels: () => [nativeModel],
      id: "extension-native",
      name: "Extension Native",
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
});

const publishesRefreshmodelsResultsWithoutForcingModelsstorePersistence = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const modelsStore = new InMemoryModelsStore();
  const runtime = yield* awaited(
    ModelRuntime.create({
      allowModelNetwork: false,
      credentials: AuthStorage.inMemory(),
      modelsPath: null,
      modelsStore,
    }),
  );
  runtime.registerProvider("extension-dynamic", {
    api: "openai-completions" as const,
    apiKey: "local",
    baseUrl: "http://localhost:8080/v1",
    refreshModels: () =>
      effectRunPromise(
        awaited([
          {
            ...model("live"),
            baseUrl: "http://localhost:8080/v1",
            provider: "extension-dynamic",
          },
        ]),
      ),
  });

  yield* awaited(runtime.refresh({ allowNetwork: false }));
  expect(runtime.getModel("extension-dynamic", "live")).toBeDefined();
  expect(yield* awaited(modelsStore.read("extension-dynamic"))).toBeUndefined();
});

const appliesLegacyOauthModifymodelsAfterAsyncCredential = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const runtime = yield* awaited(
    ModelRuntime.create({
      allowModelNetwork: false,
      credentials: AuthStorage.inMemory({
        "extension-oauth": {
          access: "access",
          expires: currentTimeMillis() + 60_000,
          refresh: "refresh",
          type: "oauth" as const,
        },
      }),
      modelsPath: null,
      modelsStore: new InMemoryModelsStore(),
    }),
  );
  runtime.registerProvider("extension-oauth", {
    api: "openai-completions" as const,
    baseUrl: "https://example.test/v1",
    models: [model("base")],
    oauth: {
      getApiKey: (credential) => credential.access,
      login: () =>
        effectRunPromise(
          Effect.sync(() => {
            throw new Error("not used");
          }),
        ),
      modifyModels: (models, credential) =>
        credential.access === "access" ? [...models, model("credential-model")] : models,
      name: "Extension OAuth",
      refreshToken: (credential) => effectRunPromise(awaited(credential)),
    },
  });

  yield* awaited(runtime.refresh({ allowNetwork: false }));
  expect(runtime.getModel("extension-oauth", "base")).toBeDefined();
  expect(runtime.getModel("extension-oauth", "credential-model")).toBeDefined();

  yield* awaited(runtime.logout("extension-oauth"));
  expect(runtime.getModel("extension-oauth", "credential-model")).toBeUndefined();
});

describe("extension provider model lifecycle", () => {
  it("applies models.json overrides above native providers", () =>
    runTest(appliesModelsJsonOverridesAboveNativeProviders));

  it("publishes refreshModels results without forcing ModelsStore persistence", () =>
    runTest(publishesRefreshmodelsResultsWithoutForcingModelsstorePersistence));

  it("applies legacy OAuth modifyModels after async credential initialization", () =>
    runTest(appliesLegacyOauthModifymodelsAfterAsyncCredential));
});
