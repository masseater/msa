import { InMemoryModelsStore, type Model, type Provider } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const { awaited, currentTimeMillis, runTest } = testing;

function model(id: string): Model<"openai-completions"> {
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

const withStoredKey = <A>(key: string | undefined, build: (key: string) => A): A | undefined =>
  key === undefined || key === "" ? undefined : build(key);

const nativeProvider = (nativeModel: Model<"openai-completions">): Provider => ({
  auth: {
    apiKey: {
      check: ({ credential }) =>
        Promise.resolve(
          withStoredKey(credential?.key, () => ({
            source: "stored native key",
            type: "api_key" as const,
          })),
        ),
      login: (interaction) =>
        Effect.runPromise(
          Effect.gen(function* () {
            return {
              key: yield* awaited(
                interaction.prompt({ message: "API key", type: "secret" as const }),
              ),
              type: "api_key" as const,
            };
          }),
        ),
      name: "Native setup",
      resolve: ({ credential }) =>
        Promise.resolve(
          withStoredKey(credential?.key, (key) => ({
            auth: { apiKey: key, baseUrl: "https://resolved.test/v1" },
            source: "stored native key",
          })),
        ),
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

const registersNativeMsaAiProvidersWithTheir = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const runtime = yield* awaited(
    ModelRuntime.create({
      allowModelNetwork: false,
      credentials: AuthStorage.inMemory(),
      modelsPath: null,
      modelsStore: new InMemoryModelsStore(),
    }),
  );
  const nativeModel = {
    ...model("native"),
    baseUrl: "https://fallback.test/v1",
    provider: "extension-native",
  };
  const provider = nativeProvider(nativeModel);

  runtime.registerNativeProvider(provider);
  const registry = new ModelRegistry(runtime);
  expect(registry.getProvider("extension-native")).toBe(provider);
  expect(registry.getRegisteredNativeProvider("extension-native")).toBe(provider);
  expect(registry.getRegisteredProviderIds()).toContain("extension-native");
  expect(registry.find("extension-native", "native")).toBeDefined();

  yield* awaited(
    runtime.login("extension-native", "api_key", {
      notify: () => {},
      prompt: () => effectRunPromise(awaited("secret")),
    }),
  );
  expect(yield* awaited(registry.getProviderAuth("extension-native"))).toMatchObject({
    auth: { apiKey: "secret", baseUrl: "https://resolved.test/v1" },
  });

  registry.unregisterProvider("extension-native");
  expect(registry.getProvider("extension-native")).toBeUndefined();
});

const marksANativeProviderWithAStored = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const runtime = yield* awaited(
    ModelRuntime.create({
      allowModelNetwork: false,
      credentials: AuthStorage.inMemory({
        "extension-native": {
          access: "access",
          expires: currentTimeMillis() + 3_600_000,
          refresh: "refresh",
          type: "oauth" as const,
        },
      }),
      modelsPath: null,
      modelsStore: new InMemoryModelsStore(),
    }),
  );
  const nativeModel = { ...model("native"), provider: "extension-native" };
  const unused = () => {
    throw new Error("unused");
  };
  const provider: Provider = {
    auth: {
      oauth: {
        login: unused,
        name: "Native OAuth",
        refresh: (credential) => effectRunPromise(awaited(credential)),
        toAuth: (credential) => effectRunPromise(awaited({ apiKey: credential.access })),
      },
    },
    getModels: () => [nativeModel],
    id: "extension-native",
    name: "Extension Native",
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
});

describe("extension provider model lifecycle", () => {
  it("registers native msa-ai providers with their auth implementation", () =>
    runTest(registersNativeMsaAiProvidersWithTheir));

  it("marks a native provider with a stored credential as configured when it registers", () =>
    runTest(marksANativeProviderWithAStored));
});
