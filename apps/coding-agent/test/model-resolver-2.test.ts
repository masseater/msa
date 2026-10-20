import type { Model } from "@msa/ai";
import { describe, expect, test } from "vite-plus/test";

import { EMPTY_MODEL_POLICY } from "../src/core/model-policy.ts";
import { resolveCliModel } from "../src/core/model-resolver.ts";
import modelResolverSupport from "./model-resolver-support.ts";

const { allModels, mockModels } = modelResolverSupport;

function policyFreeRuntime(
  models: readonly unknown[] | (() => readonly unknown[]),
  hasConfiguredAuth?: (provider: string) => boolean,
) {
  const list = () => (typeof models === "function" ? models() : models);
  return {
    getCatalogModels: list,
    getModelPolicy: () => EMPTY_MODEL_POLICY,
    getModels: list,
    ...(hasConfiguredAuth === undefined ? {} : { hasConfiguredAuth }),
  } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];
}

const direct = { ...mockModels[0], id: "claude-sonnet-4-5", provider: "anthropic-api" };

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

const registry2 = (configured: string[]) =>
  policyFreeRuntime([direct, openrouter, gateway], (provider) => configured.includes(provider));

const neuralwattModel: Model<"anthropic-messages"> = {
  api: "anthropic-messages" as const,
  baseUrl: "https://api.neuralwatt.com",
  contextWindow: 128000,
  cost: { cacheRead: 0.1, cacheWrite: 1, input: 1, output: 2 },
  id: "some-base-model",
  input: ["text"],
  maxTokens: 8192,
  name: "Some Base Model",
  provider: "neuralwatt",
  reasoning: false,
};

const modelsWithNeuralwatt = [...allModels, neuralwattModel];

const doesNotStripInvalidSuffixAsThinking = () => {
  const registry = policyFreeRuntime(allModels);

  const result = resolveCliModel({
    cliModel: "gpt-4o:extended",
    cliProvider: "openai",
    modelRuntime: registry,
  });

  expect(result.error).toBeUndefined();
  expect(result.model?.provider).toBe("openai");
  expect(result.model?.id).toBe("gpt-4o:extended");
};

const allowsCustomModelIdsForExplicitProviders = () => {
  const registry = policyFreeRuntime(allModels);

  const result = resolveCliModel({
    cliModel: "openrouter/openai/ghost-model",
    cliProvider: "openrouter",
    modelRuntime: registry,
  });

  expect(result.error).toBeUndefined();
  expect(result.model?.provider).toBe("openrouter");
  expect(result.model?.id).toBe("openai/ghost-model");
};

const returnsAClearErrorWhenThereAre = () => {
  const registry = policyFreeRuntime([]);

  const result = resolveCliModel({
    cliModel: "gpt-4o",
    cliProvider: "openai",
    modelRuntime: registry,
  });

  expect(result.model).toBeUndefined();
  expect(result.error).toContain("No models available");
};

const selectsTheAuthenticatedGatewayWithOrWithout = () => {
  for (const [cliModel, thinkingLevel] of [
    ["anthropic/claude-opus-5.5", undefined],
    ["anthropic/claude-opus-5.5:high", "high"],
  ] as const) {
    const result = resolveCliModel({ cliModel, modelRuntime: registry2(["custom-gateway"]) });

    expect(result.error).toBeUndefined();
    expect(result.model?.provider).toBe("custom-gateway");
    expect(result.thinkingLevel).toBe(thinkingLevel);
  }
};

const reportsAmbiguityInsteadOfChoosingByCatalog = () => {
  const result = resolveCliModel({
    cliModel: "anthropic/claude-opus-5.5",
    modelRuntime: registry2([]),
  });

  expect(result.model).toBeUndefined();
  expect(result.error).toContain(
    "custom-gateway/anthropic/claude-opus-5.5, openrouter/anthropic/claude-opus-5.5",
  );
  expect(result.error).toContain(
    "No matching provider is authenticated. Use --provider or provider/model.",
  );
};

const doesNotLetStoredCredentialsChooseThe = () => {
  const result = resolveCliModel({
    cliModel: "anthropic/claude-opus-5.5",
    inlineApiKey: true,
    modelRuntime: registry2(["custom-gateway"]),
  });

  expect(result.model).toBeUndefined();
  expect(result.error).toContain("--api-key does not choose a provider.");
};

const stripsThinkingSuffixFromCustomModelId = () => {
  const registry = policyFreeRuntime(modelsWithNeuralwatt);

  const result = resolveCliModel({
    cliModel: "neuralwatt/zai-org/GLM-5.1-FP8:high",
    modelRuntime: registry,
  });

  expect(result.error).toBeUndefined();
  expect(result.model?.provider).toBe("neuralwatt");

  expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8");
  expect(result.model?.reasoning).toBe(true);
  expect(result.thinkingLevel).toBe("high");
};

const customModelWithoutThinkingSuffixWorksNormally = () => {
  const registry = policyFreeRuntime(modelsWithNeuralwatt);

  const result = resolveCliModel({
    cliModel: "neuralwatt/zai-org/GLM-5.1-FP8",
    modelRuntime: registry,
  });

  expect(result.error).toBeUndefined();
  expect(result.model?.provider).toBe("neuralwatt");
  expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8");
  expect(result.thinkingLevel).toBeUndefined();
};

const allValidThinkingLevelsWorkInFallback = () => {
  const registry = policyFreeRuntime(modelsWithNeuralwatt);

  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    const result = resolveCliModel({
      cliModel: `neuralwatt/zai-org/GLM-5.1-FP8:${level}`,
      modelRuntime: registry,
    });

    expect(result.error).toBeUndefined();
    expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8");
    expect(result.thinkingLevel).toBe(level);
  }
};

const invalidThinkingSuffixOnCustomModelIs = () => {
  const registry = policyFreeRuntime(modelsWithNeuralwatt);

  const result = resolveCliModel({
    cliModel: "neuralwatt/zai-org/GLM-5.1-FP8:banana",
    modelRuntime: registry,
  });

  expect(result.error).toBeUndefined();
  expect(result.model?.provider).toBe("neuralwatt");

  expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8:banana");
  expect(result.thinkingLevel).toBeUndefined();
};

const explicitProviderWithCustomModelThinkingStrips = () => {
  const registry = policyFreeRuntime(modelsWithNeuralwatt);

  const result = resolveCliModel({
    cliModel: "zai-org/GLM-5.1-FP8:high",
    cliProvider: "neuralwatt",
    modelRuntime: registry,
  });

  expect(result.error).toBeUndefined();
  expect(result.model?.provider).toBe("neuralwatt");
  expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8");
  expect(result.thinkingLevel).toBe("high");
};

const withExplicitThinkingSuffixIsKeptAs = () => {
  const registry = policyFreeRuntime(modelsWithNeuralwatt);

  const result = resolveCliModel({
    cliModel: "neuralwatt/zai-org/GLM-5.1-FP8:high",
    cliThinking: "medium",
    modelRuntime: registry,
  });

  expect(result.error).toBeUndefined();
  expect(result.model?.provider).toBe("neuralwatt");

  expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8:high");
  expect(result.thinkingLevel).toBeUndefined();
};

describe("resolveCliModel", () => {
  test(
    "does not strip invalid :suffix as thinking level in --model (treat as raw id)",
    doesNotStripInvalidSuffixAsThinking,
  );

  test(
    "allows custom model ids for explicit providers without double prefixing",
    allowsCustomModelIdsForExplicitProviders,
  );

  test("returns a clear error when there are no models", returnsAClearErrorWhenThereAre);

  describe("duplicate raw ids behind a known provider prefix (#10160)", () => {
    test(
      "selects the authenticated gateway, with or without a thinking suffix",
      selectsTheAuthenticatedGatewayWithOrWithout,
    );

    test(
      "reports ambiguity instead of choosing by catalog order",
      reportsAmbiguityInsteadOfChoosingByCatalog,
    );

    test(
      "does not let stored credentials choose the provider for --api-key",
      doesNotLetStoredCredentialsChooseThe,
    );
  });
});

describe("resolveCliModel", () => {
  describe("custom model fallback with :thinking suffix (#5552)", () => {
    test(
      "strips :thinking suffix from custom model id in fallback path",
      stripsThinkingSuffixFromCustomModelId,
    );

    test(
      "custom model without thinking suffix works normally in fallback path",
      customModelWithoutThinkingSuffixWorksNormally,
    );

    test("all valid thinking levels work in fallback path", allValidThinkingLevelsWorkInFallback);

    test(
      "invalid thinking suffix on custom model is treated as part of model id",
      invalidThinkingSuffixOnCustomModelIs,
    );

    test(
      "explicit --provider with custom model:thinking strips suffix correctly",
      explicitProviderWithCustomModelThinkingStrips,
    );

    test(
      "with explicit --thinking, :suffix is kept as part of model id",
      withExplicitThinkingSuffixIsKeptAs,
    );
  });
});
