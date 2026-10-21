import { describe, expect, it } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import modelsModule from "../src/models.ts";
import allModule from "../src/providers/all.ts";

const {
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
} = allModule;
const { getModel: getCompatModel, getModels: getCompatModels } = compatModule;
const { getSupportedThinkingLevels } = modelsModule;

const compatFlag = (model: { readonly compat?: object | undefined }, name: string) =>
  (model.compat as Readonly<Record<string, unknown>> | undefined)?.[name] === true;

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

  expect(
    models.getModels("anthropic-api").every((model) => model.api === "anthropic-messages"),
  ).toBe(true);

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
  const openai = getBuiltinModels("openai");
  expect(openai.every((model) => compatFlag(model, "supportsStrictMode"))).toBe(true);
  const grammarModels = openai.filter((model) => compatFlag(model, "supportsOpenAIGrammarTools"));
  expect(grammarModels.length).toBeGreaterThan(0);
  expect(grammarModels.every((model) => model.api === "openai-responses")).toBe(true);
  expect(
    getBuiltinModels("anthropic-api").every((model) => compatFlag(model, "supportsStrictTools")),
  ).toBe(true);
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
  const visionModels = (provider: "anthropic-api" | "openai") =>
    getBuiltinModels(provider).filter((model) => model.input.includes("image"));
  for (const model of visionModels("anthropic-api")) {
    expect(model.inputLimits?.maxRequestBytes, model.id).toBe(32 * 1024 * 1024);
    expect([100, 600], model.id).toContain(model.inputLimits?.images?.maxPerRequest);
  }
  for (const model of visionModels("openai")) {
    expect(model.inputLimits, model.id).toMatchObject({
      images: { maxPerRequest: 1500 },
      maxRequestBytes: 512 * 1024 * 1024,
    });
  }
};

const doesNotInferImageLimitsFrom = () => {
  const openRouterModel = getBuiltinModels("openrouter").find((model) =>
    model.input.includes("image"),
  );
  expect(openRouterModel?.inputLimits).toEqual({ images: { resize: DEFAULT_IMAGE_RESIZE } });
};

const usesModelsDevEffortLevelsFor = () => {
  const googleThinking = getBuiltinModels("opencode").filter(
    (model) => model.api === "google-generative-ai" && model.thinkingLevelMap !== undefined,
  );
  expect(googleThinking.length).toBeGreaterThan(0);
  for (const model of googleThinking) {
    const mapped = Object.entries(model.thinkingLevelMap ?? {})
      .filter(([, value]) => typeof value === "string")
      .map(([level]) => level);
    expect(getSupportedThinkingLevels(model), model.id).toEqual(mapped);
  }
};

const enablesMidConversationSystemMessagesOnly = () => {
  const flagged = (model: { readonly compat?: object | undefined }) =>
    compatFlag(model, "supportsMidConvoSystemMessages");
  for (const provider of [
    "openai",
    "openai-codex",
    "anthropic-api",
    "opencode",
    "opencode-go",
    "openrouter",
  ] as const) {
    const models = getBuiltinModels(provider);
    expect(models.some(flagged), provider).toBe(true);
    expect(
      models.some((model) => !flagged(model)),
      provider,
    ).toBe(true);
  }
  for (const provider of ["openai", "openai-codex"] as const) {
    for (const model of getBuiltinModels(provider)) {
      expect(flagged(model), model.id).toBe(compatFlag(model, "supportsToolSearch"));
    }
  }
  const openaiFlagged = new Set(
    getBuiltinModels("openai")
      .filter(flagged)
      .map((model) => model.id),
  );
  for (const model of getBuiltinModels("openrouter").filter(flagged)) {
    expect(model.id.startsWith("openai/") && !model.id.includes(":"), model.id).toBe(true);
    expect(openaiFlagged.has(model.id.slice("openai/".length)), model.id).toBe(true);
  }
};

const routesProxiedToolChangesThroughVerified = () => {
  const proxied = ["opencode", "opencode-go", "openrouter"] as const;
  for (const provider of proxied) {
    const models = getBuiltinModels(provider);
    expect(
      models.some((model) => compatFlag(model, "supportsToolSearch")),
      provider,
    ).toBe(false);
    expect(
      models.some((model) => compatFlag(model, "supportsMidConvoToolChanges")),
      provider,
    ).toBe(false);
  }
  for (const provider of ["opencode", "opencode-go"] as const) {
    const models = getBuiltinModels(provider);
    expect(
      models.some((model) => compatFlag(model, "supportsAdditionalTools")),
      provider,
    ).toBe(true);
    expect(
      models.some((model) => compatFlag(model, "supportsMidConvoToolAdditions")),
      provider,
    ).toBe(true);
  }
  expect(
    getBuiltinModels("openrouter").some((model) =>
      compatFlag(model, "supportsMidConvoToolAdditions"),
    ),
  ).toBe(false);
  for (const model of getBuiltinModels("anthropic-api")) {
    if (compatFlag(model, "supportsMidConvoSystemMessages")) {
      expect(compatFlag(model, "supportsMidConvoToolChanges"), model.id).toBe(true);
    }
  }
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
