import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import modelRegistry4Support from "./model-registry-4-support.ts";
import modelRegistrySupport from "./model-registry-support.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { getModelsForProvider, providerConfig } = modelRegistry4Support;

const { awaited, runTest, toJsonText, writeTextFile } = testing;

const writeModelsJson = Effect.fn("writeModelsJson")(function* (
  providers: Record<string, ReturnType<typeof providerConfig>>,
) {
  yield* writeTextFile(fixture.modelsJsonPath, yield* toJsonText({ providers }));
});

const modelLevelBaseurlOverridesProviderLevelBaseurl = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "opencode-go": {
          apiKey: "TEST_KEY",
          baseUrl: "https://opencode.ai/zen/go/v1",
          models: [
            {
              api: "anthropic-messages",
              baseUrl: "https://opencode.ai/zen/go",
              contextWindow: 204800,
              cost: { cacheRead: 0.03, cacheWrite: 0, input: 0.3, output: 1.2 },
              id: "minimax-m2.5",
              input: ["text"],
              maxTokens: 131072,
              reasoning: true,
            },
            {
              api: "openai-completions",
              contextWindow: 204800,
              cost: { cacheRead: 0.2, cacheWrite: 0, input: 1, output: 3.2 },
              id: "glm-5",
              input: ["text"],
              maxTokens: 131072,
              reasoning: true,
            },
          ],
        },
      });

      const registry = yield* fixture.registry();
      const m25 = registry.find("opencode-go", "minimax-m2.5");
      const glm5 = registry.find("opencode-go", "glm-5");

      expect(m25?.baseUrl).toBe("https://opencode.ai/zen/go");
      expect(glm5?.baseUrl).toBe("https://opencode.ai/zen/go/v1");
    }),
  );

const modeloverridesStillApplyWhenProviderAlsoDefines = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          api: "openai-completions",
          apiKey: "OPENROUTER_API_KEY",
          baseUrl: "https://my-proxy.example.com/v1",
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Overridden Built-in Sonnet",
            },
          },
          models: [
            {
              contextWindow: 128000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "custom/openrouter-model",
              input: ["text"],
              maxTokens: 16384,
              name: "Custom OpenRouter Model",
              reasoning: false,
            },
          ],
        },
      });

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");

      expect(models.some((m) => m.id === "custom/openrouter-model")).toBe(true);
      expect(
        models.some(
          (m) => m.id === "anthropic/claude-sonnet-4.5" && m.name === "Overridden Built-in Sonnet",
        ),
      ).toBe(true);
    }),
  );

const refreshReloadsMergedCustomModelsFromDisk = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        "anthropic-api": providerConfig("https://first-proxy.example.com/v1", [
          { id: "claude-custom" },
        ]),
      });
      const registry = yield* fixture.registry();
      expect(
        getModelsForProvider(registry, "anthropic-api").some((m) => m.id === "claude-custom"),
      ).toBe(true);

      yield* writeModelsJson({
        "anthropic-api": providerConfig("https://second-proxy.example.com/v1", [
          { id: "claude-custom-2" },
        ]),
      });
      yield* awaited(registry.refresh());

      const anthropicModels = getModelsForProvider(registry, "anthropic-api");
      expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(false);
      expect(anthropicModels.some((m) => m.id === "claude-custom-2")).toBe(true);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    }),
  );

const modelOverrideAppliesToASingleBuilt = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Custom Sonnet Name",
            },
          },
        },
      });

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      expect(sonnet?.name).toBe("Custom Sonnet Name");

      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
      expect(opus?.name).not.toBe("Custom Sonnet Name");
    }),
  );

const anthropicModelOverrideReplacesAllowedFallbackMetadata = () =>
  runTest(
    Effect.gen(function* () {
      const allowedFallbackModels = [
        {
          cost: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
          model: "claude-opus-5",
          provider: "anthropic-api",
        },
        {
          cost: { cacheRead: 0.4, cacheWrite: 5, input: 4, output: 20 },
          model: "claude-opus-4-8",
          provider: "anthropic-api",
        },
      ];
      yield* fixture.writeRawModelsJson({
        "anthropic-api": {
          modelOverrides: {
            "claude-fable-5": {
              compat: { allowedFallbackModels },
            },
          },
        },
      });

      const registry = yield* fixture.registry();
      const compat = registry.find("anthropic-api", "claude-fable-5")?.compat as
        | compatTypes.AnthropicMessagesCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(compat?.allowedFallbackModels).toEqual(allowedFallbackModels);
    }),
  );

describe("ModelRegistry", () => {
  describe("custom models merge behavior", () => {
    test(
      "model-level baseUrl overrides provider-level baseUrl for custom models",
      modelLevelBaseurlOverridesProviderLevelBaseurl,
    );

    test(
      "modelOverrides still apply when provider also defines models",
      modeloverridesStillApplyWhenProviderAlsoDefines,
    );

    test(
      "refresh() reloads merged custom models from disk",
      refreshReloadsMergedCustomModelsFromDisk,
    );
  });

  describe("modelOverrides (per-model customization)", () => {
    test("model override applies to a single built-in model", modelOverrideAppliesToASingleBuilt);

    test(
      "Anthropic model override replaces allowed fallback metadata",
      anthropicModelOverrideReplacesAllowedFallbackMetadata,
    );
  });
});
