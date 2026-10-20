import { describe, expect, it } from "vite-plus/test";

import buildOpenRouterCatalog from "../scripts/openrouter-catalog.ts";
import type openrouterCatalogTypes from "../scripts/openrouter-catalog.types.ts";

const imageOnly: openrouterCatalogTypes.OpenRouterModelListItem = {
  architecture: {
    input_modalities: ["text", "image"],
    output_modalities: ["image"],
  },
  id: "example/image-model",
  name: "Example Image Model",
  pricing: {
    completion: "0.000002",
    prompt: "0.000001",
  },
};

const chatWithImages: openrouterCatalogTypes.OpenRouterModelListItem = {
  architecture: {
    input_modalities: ["text", "image"],
    modality: "text+image->text+image",
    output_modalities: ["text", "image"],
  },
  context_length: 32000,
  id: "example/multimodal",
  name: "Example Multimodal",
  supported_parameters: ["tools"],
};

const chatOnly: openrouterCatalogTypes.OpenRouterModelListItem = {
  architecture: { modality: "text->text", output_modalities: ["text"] },
  id: "example/chat",
  name: "Example Chat",
  supported_parameters: ["tools"],
};

const decisionModel: openrouterCatalogTypes.OpenRouterModelListItem = {
  architecture: {
    input_modalities: ["text"],
    modality: "text->decisions",
    output_modalities: ["decisions"],
  },
  context_length: 32000,
  id: "typesafe/jev-1.13",
  name: "TypeSafe: Jev 1.13",
  pricing: { completion: "0", prompt: "0.000000042" },
  supported_parameters: [],
  top_provider: { context_length: 32000, max_completion_tokens: 28800 },
};

describe("OpenRouter catalog parsing", () => {
  it("emits image-only models from the image listing as image models", () => {
    const catalog = buildOpenRouterCatalog([], [imageOnly], []);
    expect(catalog.chat).toEqual([]);
    expect(catalog.images).toEqual([
      expect.objectContaining({
        api: "openrouter-images",
        cost: expect.objectContaining({ input: 1, output: 2 }),
        id: "example/image-model",
        input: ["text", "image"],
        output: ["image"],
        type: "image",
      }),
    ]);
  });

  it("emits separate chat and image entries for an id that supports both operations", () => {
    const catalog = buildOpenRouterCatalog(
      [chatWithImages, chatOnly],
      [chatWithImages, imageOnly],
      [],
    );
    expect(catalog.chat.map((model) => model.id)).toEqual(["example/multimodal", "example/chat"]);
    expect(catalog.chat.map((model) => model.type)).toEqual(["chat", "chat"]);
    expect(catalog.images.map((model) => model.id)).toEqual([
      "example/multimodal",
      "example/image-model",
    ]);
    expect(catalog.images.every((model) => model.type === "image")).toBe(true);
    expect(catalog.images.map((model) => model.output)).toEqual([["text", "image"], ["image"]]);
  });

  it("ignores listed models that neither support tools nor emit images", () => {
    const catalog = buildOpenRouterCatalog(
      [{ ...chatOnly, supported_parameters: [] }],
      [{ ...imageOnly, architecture: { output_modalities: ["text"] } }],
      [{ ...decisionModel, architecture: { output_modalities: ["text"] } }],
    );
    expect(catalog.chat).toEqual([]);
    expect(catalog.images).toEqual([]);
    expect(catalog.classifiers).toEqual([]);
  });
});

describe("OpenRouter catalog parsing", () => {
  it("emits decision models as System One classifier models", () => {
    const catalog = buildOpenRouterCatalog([], [], [decisionModel, decisionModel]);
    expect(catalog.chat).toEqual([]);
    expect(catalog.classifiers).toEqual([
      {
        api: "typesafe-system-one",
        baseUrl: "https://openrouter.ai/api/v1",
        contextWindow: 32000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0.042, output: 0 },
        id: "typesafe/jev-1.13",
        input: ["text"],
        name: "TypeSafe: Jev 1.13",
        provider: "openrouter",
        type: "classifier",
      },
    ]);
  });
});
