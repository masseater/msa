import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import modelRegistry4Support from "./model-registry-4-support.ts";
import modelRegistrySupport from "./model-registry-support.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { getModelsForProvider } = modelRegistry4Support;

const { runTest } = testing;

const providerLevelCompatAppliesToBuiltIn = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          compat: {
            supportsStrictMode: false,
            supportsUsageInStreaming: false,
          },
        },
      });

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");

      expect(models.length).toBeGreaterThan(0);
      for (const model of models) {
        const compat = model.compat as compatTypes.OpenAICompletionsCompat | undefined;
        expect(compat?.supportsUsageInStreaming).toBe(false);
        expect(compat?.supportsStrictMode).toBe(false);
      }
    }),
  );

const modelSchemaAcceptsThinkinglevelmapAndCompatSchema = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        demo: {
          api: "openai-completions",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com/v1",
          models: [
            {
              compat: {
                cacheControlFormat: "anthropic",
                supportsStrictMode: false,
              },
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "demo-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: true,
              thinkingLevelMap: {
                high: "max",
                minimal: null,
              },
            },
          ],
        },
      });

      const registry = yield* fixture.registry();
      const model = registry.find("demo", "demo-model");
      const compat = model?.compat as compatTypes.OpenAICompletionsCompat | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(model?.thinkingLevelMap).toEqual({ high: "max", minimal: null });
      expect(compat?.supportsStrictMode).toBe(false);
      expect(compat?.cacheControlFormat).toBe("anthropic");
    }),
  );

const compatSchemaAcceptsChatTemplateThinkingConfiguration = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        demo: {
          api: "openai-completions",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com/v1",
          models: [
            {
              compat: {
                chatTemplateKwargs: {
                  preserve_thinking: true,
                  thinking: { $var: "thinking.enabled" },
                },
                thinkingFormat: "chat-template",
              },
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "kwargs-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: true,
            },
          ],
        },
      });

      const registry = yield* fixture.registry();
      const kwargsCompat = registry.find("demo", "kwargs-model")?.compat as
        | compatTypes.OpenAICompletionsCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(kwargsCompat?.thinkingFormat).toBe("chat-template");
      expect(kwargsCompat?.chatTemplateKwargs).toEqual({
        preserve_thinking: true,
        thinking: { $var: "thinking.enabled" },
      });
    }),
  );

const compatSchemaAcceptsAnthropicEagerToolInput = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        demo: {
          api: "anthropic-messages",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com",
          compat: {
            supportsEagerToolInputStreaming: false,
          },
          models: [
            {
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "demo-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: true,
            },
          ],
        },
      });

      const registry = yield* fixture.registry();
      const compat = registry.find("demo", "demo-model")?.compat as
        | compatTypes.AnthropicMessagesCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(compat?.supportsEagerToolInputStreaming).toBe(false);
    }),
  );

const compatSchemaAcceptsLongCacheRetentionFlag = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        demo: {
          api: "anthropic-messages",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com",
          compat: {
            supportsLongCacheRetention: false,
          },
          models: [
            {
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "demo-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: true,
            },
          ],
        },
      });

      const registry = yield* fixture.registry();
      const compat = registry.find("demo", "demo-model")?.compat as
        | compatTypes.AnthropicMessagesCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(compat?.supportsLongCacheRetention).toBe(false);
    }),
  );

describe("ModelRegistry", () => {
  describe("custom models merge behavior", () => {
    test("provider-level compat applies to built-in models", providerLevelCompatAppliesToBuiltIn);

    test(
      "model schema accepts thinkingLevelMap and compat schema accepts supportsStrictMode and cacheControlFormat",
      modelSchemaAcceptsThinkinglevelmapAndCompatSchema,
    );

    test(
      "compat schema accepts chat template thinking configuration",
      compatSchemaAcceptsChatTemplateThinkingConfiguration,
    );

    test(
      "compat schema accepts Anthropic eager tool input streaming flag",
      compatSchemaAcceptsAnthropicEagerToolInput,
    );

    test(
      "compat schema accepts long cache retention flag",
      compatSchemaAcceptsLongCacheRetentionFlag,
    );
  });
});
