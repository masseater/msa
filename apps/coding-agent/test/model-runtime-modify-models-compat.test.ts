import { InMemoryModelsStore, type Model, type Provider } from "@msa/ai";
import { awaited, currentTimeMillis, runTest } from "@msa/testing";
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

const withStoredKey = <A>(key: string | undefined, build: (key: string) => A): A | undefined =>
  key === undefined || key === "" ? undefined : build(key);

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
                    withStoredKey(credential?.key, () => ({
                      type: "api_key" as const,
                      source: "stored native key",
                    })),
                  ),
                ),
              resolve: ({ credential }) =>
                effectRunPromise(
                  awaited(
                    withStoredKey(credential?.key, (key) => ({
                      auth: { apiKey: key, baseUrl: "https://resolved.test/v1" },
                      source: "stored native key",
                    })),
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
});
