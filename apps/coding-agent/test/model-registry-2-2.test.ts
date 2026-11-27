import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import modelRegistrySupport from "./model-registry-support.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, runTest } = testing;

const providerLevelCompatAppliesToCustomModels = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        demo: {
          api: "openai-completions",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com/v1",
          compat: {
            maxTokensField: "max_tokens",
            supportsUsageInStreaming: false,
          },
          models: [
            {
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "demo-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: false,
            },
          ],
        },
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const compat = registry.find("demo", "demo-model")?.compat as
        | compatTypes.OpenAICompletionsCompat
        | undefined;

      expect(compat?.supportsUsageInStreaming).toBe(false);
      expect(compat?.maxTokensField).toBe("max_tokens");
    }),
  );

const modelLevelCompatOverridesProviderLevelCompat = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        demo: {
          api: "openai-completions",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com/v1",
          compat: {
            maxTokensField: "max_tokens",
            supportsUsageInStreaming: false,
          },
          models: [
            {
              compat: {
                maxTokensField: "max_completion_tokens",
                supportsUsageInStreaming: true,
              },
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "demo-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: false,
            },
          ],
        },
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const compat = registry.find("demo", "demo-model")?.compat as
        | compatTypes.OpenAICompletionsCompat
        | undefined;

      expect(compat?.supportsUsageInStreaming).toBe(true);
      expect(compat?.maxTokensField).toBe("max_completion_tokens");
    }),
  );

describe("ModelRegistry", () => {
  describe("custom models merge behavior", () => {
    test(
      "provider-level compat applies to custom models",
      providerLevelCompatAppliesToCustomModels,
    );

    test(
      "model-level compat overrides provider-level compat for custom models",
      modelLevelCompatOverridesProviderLevelCompat,
    );
  });
});
