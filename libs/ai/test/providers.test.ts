import { describe, expect, it } from "vite-plus/test";

import { getModel as getCompatModel, getModels as getCompatModels } from "../src/compat.ts";
import { getSupportedThinkingLevels } from "../src/models.ts";
import {
  builtinModels,
  builtinProviders,
  getAllBuiltinModels,
  getBuiltinClassifierModel,
  getBuiltinClassifierModels,
  getBuiltinImageModel,
  getBuiltinImageModels,
  getBuiltinModel,
  getBuiltinModels,
  getBuiltinProviders,
} from "../src/providers/all.ts";
const DEFAULT_IMAGE_RESIZE = {
  jpegQuality: 80,
  maxBytes: 4.5 * 1024 * 1024,
  maxHeight: 2000,
  maxWidth: 2000,
};

const builtinmodelsRegistersEveryBuiltinProviderWith = () => {
  const models = builtinModels();
  const providers = models.getProviders();
  expect(providers.length).toBe(builtinProviders().length);
  expect(providers.map((p) => p.id)).toContain("anthropic-api");

  const anthropic = models.getModel("anthropic-api", "claude-haiku-4-5");
  expect(anthropic?.api).toBe("anthropic-messages");

  const all = models.getModels();
  expect(all.length).toBeGreaterThan(500);

  for (const provider of providers) {
    const list = models.getAllModels(provider.id);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((m) => m.provider === provider.id)).toBe(true);
  }

  return Promise.resolve();
};

const returnsEmptyResultsForUnknownProvider = () => {
  const unknownProvider = "not-a-provider" as never;
  const unknownModel = "x" as never;

  expect(getBuiltinModel(unknownProvider, unknownModel)).toBeUndefined();
  expect(getBuiltinImageModel(unknownProvider, unknownModel)).toBeUndefined();
  expect(getBuiltinClassifierModel(unknownProvider, unknownModel)).toBeUndefined();
  expect(getBuiltinModels(unknownProvider)).toEqual([]);
  expect(getBuiltinImageModels(unknownProvider)).toEqual([]);
  expect(getBuiltinClassifierModels(unknownProvider)).toEqual([]);
  expect(getAllBuiltinModels(unknownProvider)).toEqual([]);
  expect(getCompatModel(unknownProvider, unknownModel)).toBeUndefined();
  expect(getCompatModels(unknownProvider)).toEqual([]);
};

const storesNativeConstrainedSamplingCapabilitiesIn = () => {
  const gpt4o = getBuiltinModel("openai", "gpt-4o");
  expect(gpt4o.compat?.supportsStrictMode).toBe(true);
  expect(gpt4o.compat?.supportsOpenAIGrammarTools).toBeUndefined();
  expect(getBuiltinModel("openai", "gpt-5.4").compat).toMatchObject({
    supportsOpenAIGrammarTools: true,
    supportsStrictMode: true,
  });
  expect(getBuiltinModel("anthropic-api", "claude-haiku-4-5").compat?.supportsStrictTools).toBe(
    true,
  );
};

const keepsTheConservativeResizeProfileOn = () => {
  const visionModels = getBuiltinProviders()
    .flatMap((provider) => getBuiltinModels(provider))
    .filter((model) => model.input.includes("image"));
  expect(visionModels.length).toBeGreaterThan(0);
  for (const model of visionModels) {
    expect(model.inputLimits?.images?.resize).toEqual(DEFAULT_IMAGE_RESIZE);
  }
};

const recordsKnownDirectProviderImageRequest = () => {
  expect(getBuiltinModel("anthropic-api", "claude-haiku-4-5").inputLimits).toMatchObject({
    images: { maxPerRequest: 100 },
    maxRequestBytes: 32 * 1024 * 1024,
  });
  expect(getBuiltinModel("anthropic-api", "claude-opus-5").inputLimits?.images?.maxPerRequest).toBe(
    600,
  );
  expect(getBuiltinModel("openai", "gpt-4o").inputLimits).toMatchObject({
    images: { maxPerRequest: 1500 },
    maxRequestBytes: 512 * 1024 * 1024,
  });
};

const doesNotInferImageLimitsFrom = () => {
  const openRouterModel = getBuiltinModels("openrouter").find((model) =>
    model.input.includes("image"),
  );
  expect(openRouterModel?.inputLimits).toEqual({ images: { resize: DEFAULT_IMAGE_RESIZE } });
};

const usesModelsDevEffortLevelsFor = () => {
  expect(getSupportedThinkingLevels(getBuiltinModel("opencode", "gemini-3.8-flash"))).toEqual([
    "low",
    "medium",
    "high",
  ]);
};

const enablesMidConversationSystemMessagesOnly = () => {
  const models = builtinModels();
  const supported = [
    ["openai", "gpt-5.4"],
    ["openai", "gpt-5.5"],
    ["openai", "gpt-6-astra"],
    ["openai-codex", "gpt-5.5"],
    ["anthropic-api", "claude-opus-5"],
    ["opencode", "gpt-5.4"],
    ["opencode", "gpt-5.6-terra"],
    ["opencode-go", "gpt-5.6-luna"],
    ["opencode", "claude-opus-4-8"],
    ["opencode", "claude-opus-5"],
    ["opencode", "kimi-k3"],
    ["opencode-go", "kimi-k3"],
    ["openrouter", "openai/gpt-5.6-terra"],
  ] as const;
  const unsupported = [
    ["openai", "gpt-4.1"],
    ["openai", "gpt-5.2"],
    ["anthropic-api", "claude-sonnet-4-5"],
    ["opencode", "gemini-3.1-pro"],
    ["opencode", "gpt-5.2"],
    ["opencode", "claude-sonnet-4-5"],
    ["openrouter", "anthropic/claude-opus-5"],
    ["openrouter", "moonshotai/kimi-k3"],
    ["openrouter", "openai/gpt-5.6-terra:batch"],
  ] as const;
  for (const [provider, modelId] of supported) {
    expect(models.getModel(provider, modelId), `${provider}/${modelId}`).toHaveProperty(
      "compat.supportsMidConvoSystemMessages",
      true,
    );
  }
  for (const [provider, modelId] of unsupported) {
    expect(models.getModel(provider, modelId), `${provider}/${modelId}`).not.toHaveProperty(
      "compat.supportsMidConvoSystemMessages",
    );
  }
};

const routesProxiedToolChangesThroughVerified = () => {
  const models = builtinModels();
  expect(models.getModel("opencode", "gpt-5.6-terra")?.compat).toMatchObject({
    supportsAdditionalTools: true,
  });
  expect(models.getModel("opencode", "gpt-5.6-terra")?.compat).not.toHaveProperty(
    "supportsToolSearch",
  );
  expect(models.getModel("opencode", "claude-opus-5")?.compat).not.toHaveProperty(
    "supportsMidConvoToolChanges",
  );
  expect(models.getModel("anthropic-api", "claude-opus-5")?.compat).toMatchObject({
    supportsMidConvoToolChanges: true,
  });
  for (const provider of ["opencode", "opencode-go"] as const) {
    expect(models.getModel(provider, "kimi-k3")?.compat, provider).toMatchObject({
      supportsMidConvoToolAdditions: true,
    });
  }
  expect(models.getModel("openrouter", "moonshotai/kimi-k3")?.compat).not.toHaveProperty(
    "supportsMidConvoToolAdditions",
  );
  expect(models.getModel("openrouter", "openai/gpt-5.6-terra")?.compat).not.toHaveProperty(
    "supportsMidConvoToolAdditions",
  );
};

describe("builtin providers", () => {
  it(
    "builtinModels registers every builtin provider with models",
    builtinmodelsRegistersEveryBuiltinProviderWith,
  );

  it("returns empty results for unknown provider ids", returnsEmptyResultsForUnknownProvider);
});

describe("builtin providers", () => {
  it(
    "stores native constrained-sampling capabilities in model metadata",
    storesNativeConstrainedSamplingCapabilitiesIn,
  );
});

describe("builtin providers", () => {
  it(
    "keeps the conservative resize profile on every vision model",
    keepsTheConservativeResizeProfileOn,
  );

  it("records known direct-provider image request limits", recordsKnownDirectProviderImageRequest);

  it("does not infer image limits from gateway API compatibility", doesNotInferImageLimitsFrom);
});

describe("builtin providers", () => {
  it("uses models.dev effort levels for Google thinking models", usesModelsDevEffortLevelsFor);
});

describe("builtin providers", () => {
  it(
    "enables mid-conversation system messages only for verified models",
    enablesMidConversationSystemMessagesOnly,
  );
});

describe("builtin providers", () => {
  it(
    "routes proxied tool changes through verified transports only",
    routesProxiedToolChangesThroughVerified,
  );
});
