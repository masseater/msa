import type { Model } from "@msa/ai";
import { describe, expect, test } from "vite-plus/test";

import { resolveCliModel } from "../src/core/model-resolver.ts";
import { allModels, mockModels } from "./model-resolver-support.ts";

describe("resolveCliModel", () => {
  test("does not strip invalid :suffix as thinking level in --model (treat as raw id)", () => {
    const registry = {
      getModels: () => allModels,
    } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];

    const result = resolveCliModel({
      cliProvider: "openai",
      cliModel: "gpt-4o:extended",
      modelRuntime: registry,
    });

    expect(result.error).toBeUndefined();
    expect(result.model?.provider).toBe("openai");
    expect(result.model?.id).toBe("gpt-4o:extended");
  });

  test("allows custom model ids for explicit providers without double prefixing", () => {
    const registry = {
      getModels: () => allModels,
    } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];

    const result = resolveCliModel({
      cliProvider: "openrouter",
      cliModel: "openrouter/openai/ghost-model",
      modelRuntime: registry,
    });

    expect(result.error).toBeUndefined();
    expect(result.model?.provider).toBe("openrouter");
    expect(result.model?.id).toBe("openai/ghost-model");
  });

  test("returns a clear error when there are no models", () => {
    const registry = {
      getModels: () => [],
    } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];

    const result = resolveCliModel({
      cliProvider: "openai",
      cliModel: "gpt-4o",
      modelRuntime: registry,
    });

    expect(result.model).toBeUndefined();
    expect(result.error).toContain("No models available");
  });

  describe("duplicate raw ids behind a known provider prefix (#10160)", () => {
    const direct = { ...mockModels[0], id: "claude-sonnet-4-5", provider: "anthropic" };
    const openrouter = {
      ...mockModels[0],
      id: "anthropic/claude-opus-5.5",
      provider: "openrouter",
    };
    const gateway = {
      ...mockModels[0],
      id: "anthropic/claude-opus-5.5",
      provider: "custom-gateway",
    };
    const registry = (configured: string[]) =>
      ({
        getModels: () => [direct, openrouter, gateway],
        hasConfiguredAuth: (provider: string) => configured.includes(provider),
      }) as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];

    test("selects the authenticated gateway, with or without a thinking suffix", () => {
      for (const [cliModel, thinkingLevel] of [
        ["anthropic/claude-opus-5.5", undefined],
        ["anthropic/claude-opus-5.5:high", "high"],
      ] as const) {
        const result = resolveCliModel({ cliModel, modelRuntime: registry(["custom-gateway"]) });

        expect(result.error).toBeUndefined();
        expect(result.model?.provider).toBe("custom-gateway");
        expect(result.thinkingLevel).toBe(thinkingLevel);
      }
    });

    test("reports ambiguity instead of choosing by catalog order", () => {
      const result = resolveCliModel({
        cliModel: "anthropic/claude-opus-5.5",
        modelRuntime: registry([]),
      });

      expect(result.model).toBeUndefined();
      expect(result.error).toContain(
        "custom-gateway/anthropic/claude-opus-5.5, openrouter/anthropic/claude-opus-5.5",
      );
      expect(result.error).toContain(
        "No matching provider is authenticated. Use --provider or provider/model.",
      );
    });

    test("does not let stored credentials choose the provider for --api-key", () => {
      const result = resolveCliModel({
        cliModel: "anthropic/claude-opus-5.5",
        inlineApiKey: true,
        modelRuntime: registry(["custom-gateway"]),
      });

      expect(result.model).toBeUndefined();
      expect(result.error).toContain("--api-key does not choose a provider.");
    });
  });

  describe("custom model fallback with :thinking suffix (#5552)", () => {
    const neuralwattModel: Model<"anthropic-messages"> = {
      id: "some-base-model",
      name: "Some Base Model",
      api: "anthropic-messages" as const,
      provider: "neuralwatt",
      baseUrl: "https://api.neuralwatt.com",
      reasoning: false,
      input: ["text"],
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
      contextWindow: 128000,
      maxTokens: 8192,
    };

    const modelsWithNeuralwatt = [...allModels, neuralwattModel];

    test("strips :thinking suffix from custom model id in fallback path", () => {
      const registry = {
        getModels: () => modelsWithNeuralwatt,
      } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];

      const result = resolveCliModel({
        cliModel: "neuralwatt/zai-org/GLM-5.1-FP8:high",
        modelRuntime: registry,
      });

      expect(result.error).toBeUndefined();
      expect(result.model?.provider).toBe("neuralwatt");

      expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8");
      expect(result.model?.reasoning).toBe(true);
      expect(result.thinkingLevel).toBe("high");
    });

    test("custom model without thinking suffix works normally in fallback path", () => {
      const registry = {
        getModels: () => modelsWithNeuralwatt,
      } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];

      const result = resolveCliModel({
        cliModel: "neuralwatt/zai-org/GLM-5.1-FP8",
        modelRuntime: registry,
      });

      expect(result.error).toBeUndefined();
      expect(result.model?.provider).toBe("neuralwatt");
      expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8");
      expect(result.thinkingLevel).toBeUndefined();
    });

    test("all valid thinking levels work in fallback path", () => {
      const registry = {
        getModels: () => modelsWithNeuralwatt,
      } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];

      for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
        const result = resolveCliModel({
          cliModel: `neuralwatt/zai-org/GLM-5.1-FP8:${level}`,
          modelRuntime: registry,
        });

        expect(result.error).toBeUndefined();
        expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8");
        expect(result.thinkingLevel).toBe(level);
      }
    });

    test("invalid thinking suffix on custom model is treated as part of model id", () => {
      const registry = {
        getModels: () => modelsWithNeuralwatt,
      } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];

      const result = resolveCliModel({
        cliModel: "neuralwatt/zai-org/GLM-5.1-FP8:banana",
        modelRuntime: registry,
      });

      expect(result.error).toBeUndefined();
      expect(result.model?.provider).toBe("neuralwatt");

      expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8:banana");
      expect(result.thinkingLevel).toBeUndefined();
    });

    test("explicit --provider with custom model:thinking strips suffix correctly", () => {
      const registry = {
        getModels: () => modelsWithNeuralwatt,
      } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];

      const result = resolveCliModel({
        cliProvider: "neuralwatt",
        cliModel: "zai-org/GLM-5.1-FP8:high",
        modelRuntime: registry,
      });

      expect(result.error).toBeUndefined();
      expect(result.model?.provider).toBe("neuralwatt");
      expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8");
      expect(result.thinkingLevel).toBe("high");
    });

    test("with explicit --thinking, :suffix is kept as part of model id", () => {
      const registry = {
        getModels: () => modelsWithNeuralwatt,
      } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];

      const result = resolveCliModel({
        cliModel: "neuralwatt/zai-org/GLM-5.1-FP8:high",
        cliThinking: "medium",
        modelRuntime: registry,
      });

      expect(result.error).toBeUndefined();
      expect(result.model?.provider).toBe("neuralwatt");

      expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8:high");
      expect(result.thinkingLevel).toBeUndefined();
    });
  });
});
