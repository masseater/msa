import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import type modelRegistryTypes from "../src/core/model-registry.types.ts";
import modelRegistryFixture from "./model-registry-fixture.ts";
import modelRegistrySupport from "./model-registry-support.ts";

const { getApiProvider } = compat;

const { useModelRegistryFixture } = modelRegistryFixture;
const { captureThrown, emptyContext, openAiModel } = modelRegistrySupport;

const { awaited, currentTimeMillis, runTest } = testing;

const fixture = useModelRegistryFixture();

function providerConfig(
  baseUrl: string,
  models: Array<{ id: string; name?: string }>,
  api: string = "anthropic-messages",
): modelRegistryTypes.ProviderConfigInput {
  return {
    api: api as compatTypes.Api,
    apiKey: "test-key",
    baseUrl,
    models: models.map((m) => ({
      contextWindow: 100000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: m.id,
      input: ["text"],
      maxTokens: 8000,
      name: m.name ?? m.id,
      reasoning: false,
    })),
  };
}

function getModelsForProvider(registry: modelRegistryTypes.ModelRegistry, provider: string) {
  return registry.getAll().filter((m) => m.provider === provider);
}

const failedRegisterproviderDoesNotRemoveExistingProvider = () =>
  runTest(
    Effect.gen(function* () {
      const registry = yield* awaited(fixture.createRegistry());

      registry.registerProvider("demo-provider", {
        api: "openai-completions",
        apiKey: "test-key",
        baseUrl: "https://provider.test/v1",
        models: [
          {
            contextWindow: 128000,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
            id: "demo-model",
            input: ["text"],
            maxTokens: 4096,
            name: "Demo Model",
            reasoning: false,
          },
        ],
      });

      expect(registry.find("demo-provider", "demo-model")).toBeDefined();

      expect(() =>
        registry.registerProvider("demo-provider", {
          apiKey: "test-key",
          baseUrl: "https://provider.test/v2",
          models: [
            {
              contextWindow: 128000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "broken-model",
              input: ["text"],
              maxTokens: 4096,
              name: "Broken Model",
              reasoning: false,
            },
          ],
        }),
      ).toThrow('Provider demo-provider, model broken-model: no "api" specified.');

      expect(registry.find("demo-provider", "demo-model")).toBeDefined();
      yield* awaited(expect(registry.refresh()).resolves.toMatchObject({ aborted: false }));
      expect(registry.find("demo-provider", "demo-model")).toBeDefined();
    }),
  );

const unregisterproviderRemovesTheRuntimeOauthOverlayWithout = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const registry = yield* awaited(fixture.createRegistry());

      registry.registerProvider("anthropic-api", {
        oauth: {
          getApiKey: (credentials) => credentials.access,
          login: () =>
            effectRunPromise(
              awaited({
                access: "custom-access-token",
                expires: currentTimeMillis() + 60_000,
                refresh: "custom-refresh-token",
              }),
            ),
          name: "Custom Anthropic OAuth",
          refreshToken: (credentials) => effectRunPromise(awaited(credentials)),
        },
      });

      expect(registry.getRegisteredProviderConfig("anthropic-api")?.oauth?.name).toBe(
        "Custom Anthropic OAuth",
      );

      registry.unregisterProvider("anthropic-api");

      expect(registry.getRegisteredProviderConfig("anthropic-api")).toBeUndefined();
    }),
  );

const streamsimpleOverlaysDoNotMutateTheGlobal = () =>
  runTest(
    Effect.gen(function* () {
      const registry = yield* awaited(fixture.createRegistry());

      registry.registerProvider("stream-override-provider", {
        api: "openai-completions",
        streamSimple: () => {
          throw new Error("custom streamSimple override");
        },
      });

      expect(
        captureThrown(() =>
          getApiProvider("openai-completions")?.streamSimple(openAiModel, emptyContext),
        ),
      ).toBeUndefined();

      registry.unregisterProvider("stream-override-provider");

      expect(
        captureThrown(() =>
          getApiProvider("openai-completions")?.streamSimple(openAiModel, emptyContext),
        ),
      ).toBeUndefined();
    }),
  );

const baseurlOnlyOverrideKeepsBuiltInProvider = () =>
  runTest(
    Effect.gen(function* () {
      const registry = yield* awaited(fixture.createRegistry());

      registry.registerProvider("anthropic-api", { baseUrl: "https://proxy.test/anthropic" });
      yield* awaited(registry.refresh());

      const anthropicModels = getModelsForProvider(registry, "anthropic-api");
      expect(anthropicModels.length).toBeGreaterThan(1);
      expect(anthropicModels.every((m) => m.baseUrl === "https://proxy.test/anthropic")).toBe(true);
    }),
  );

const modelsOnlyOverrideReplacesBuiltInProvider = () =>
  runTest(
    Effect.gen(function* () {
      const registry = yield* awaited(fixture.createRegistry());

      registry.registerProvider("anthropic-api", {
        ...providerConfig(
          "https://custom.test/anthropic",
          [{ id: "custom-claude" }],
          "anthropic-messages",
        ),
        baseUrl: "https://custom.test/anthropic",
      });
      yield* awaited(registry.refresh());

      expect(getModelsForProvider(registry, "anthropic-api").map((m) => m.id)).toEqual([
        "custom-claude",
      ]);
      expect(registry.find("anthropic-api", "custom-claude")?.baseUrl).toBe(
        "https://custom.test/anthropic",
      );
    }),
  );

const modelsPlusBaseurlOverrideReplacesBuiltIn = () =>
  runTest(
    Effect.gen(function* () {
      const registry = yield* awaited(fixture.createRegistry());

      registry.registerProvider("anthropic-api", {
        ...providerConfig(
          "https://custom.test/anthropic",
          [{ id: "custom-claude" }],
          "anthropic-messages",
        ),
        baseUrl: "https://custom.test/anthropic",
      });
      registry.registerProvider("anthropic-api", { baseUrl: "https://proxy.test/anthropic" });
      yield* awaited(registry.refresh());

      expect(getModelsForProvider(registry, "anthropic-api").map((m) => m.id)).toEqual([
        "custom-claude",
      ]);
      expect(registry.find("anthropic-api", "custom-claude")?.baseUrl).toBe(
        "https://proxy.test/anthropic",
      );
    }),
  );

describe("ModelRegistry", () => {
  describe("dynamic provider lifecycle", () => {
    test(
      "failed registerProvider does not remove existing provider models",
      failedRegisterproviderDoesNotRemoveExistingProvider,
    );

    test(
      "unregisterProvider removes the runtime OAuth overlay without mutating global state",
      unregisterproviderRemovesTheRuntimeOauthOverlayWithout,
    );

    test(
      "streamSimple overlays do not mutate the global compat API registry",
      streamsimpleOverlaysDoNotMutateTheGlobal,
    );

    describe("dynamic provider override persistence", () => {
      test(
        "baseUrl-only override keeps built-in provider models after refresh",
        baseurlOnlyOverrideKeepsBuiltInProvider,
      );

      test(
        "models-only override replaces built-in provider models after refresh",
        modelsOnlyOverrideReplacesBuiltInProvider,
      );

      test(
        "models plus baseUrl override replaces built-in provider models after refresh",
        modelsPlusBaseurlOverrideReplacesBuiltIn,
      );
    });
  });
});
