import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { getModels as getCompatModels } from "../src/compat.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { createModels, createProvider, isModelType } from "../src/models.ts";
import {
  builtinModels,
  getAllBuiltinModels,
  getBuiltinClassifierModels,
  getBuiltinImageModel,
  getBuiltinImageModels,
  getBuiltinModels,
} from "../src/providers/all.ts";
import imagesModelsSupport from "./images-models-support.ts";

const { chatModel, fakeAuthContext, imageModel, okResult } = imagesModelsSupport;

const supportsDynamicProvidersListingImageModels = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let fetches = 0;
      const modelsStore = new InMemoryModelsStore();
      const models = createModels({ modelsStore });
      models.setProvider(
        createProvider({
          auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
          fetchModels: () => {
            fetches++;
            return Promise.resolve([imageModel("dyn", "listed"), chatModel("dyn", "chat")]);
          },
          id: "dyn",
          images: {
            "test-images": { generateImages: (model) => Promise.resolve(okResult(model)) },
          },
          models: [],
        }),
      );

      expect(models.getAllModels("dyn")).toEqual([]);
      const result = yield* Effect.promise(() => models.refresh({ providers: ["dyn"] }));
      expect(result.errors.size).toBe(0);
      expect(fetches).toBe(1);
      expect(models.getModelOfType("image", "dyn", "listed")).toBeDefined();
      expect(models.getModel("dyn", "chat")).toBeDefined();
      const stored = yield* Effect.promise(() => modelsStore.read("dyn"));
      expect(stored?.models.map((model) => model.id)).toEqual(["listed", "chat"]);
    }),
  );

const keepsExistingBuiltInAndCompat = () => {
  const chat = getBuiltinModels("openrouter");
  const images = getBuiltinImageModels("openrouter");
  const all = getAllBuiltinModels("openrouter");
  const compat = getCompatModels("openrouter");

  expect(chat.every((model) => isModelType(model, "chat"))).toBe(true);
  expect(images.every((model) => isModelType(model, "image"))).toBe(true);
  expect(all.some((model) => isModelType(model, "image"))).toBe(true);
  expect(compat).toEqual(chat);
  expect(chat.every((model) => model.contextWindow > 0)).toBe(true);
  expect(chat.length + images.length + getBuiltinClassifierModels("openrouter").length).toBe(
    all.length,
  );
  expect(getBuiltinImageModel("openrouter", "black-forest-labs/flux.2-pro").type).toBe("image");
};

const builtinmodelsExposesOpenRouterImageModelsUnder = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const models = builtinModels({
        authContext: fakeAuthContext({ OPENROUTER_API_KEY: "or-key" }),
      });
      const provider = models.getProvider("openrouter")!;
      const images = models.getModelsOfType("image", "openrouter");
      expect(images.length).toBeGreaterThan(0);
      expect(provider.getModels().every((model) => isModelType(model, "chat"))).toBe(true);
      expect(provider.getAllModels?.().some((model) => isModelType(model, "image"))).toBe(true);
      expect(images.every((m) => m.type === "image" && m.api === "openrouter-images")).toBe(true);
      expect(models.getModelsOfType("image").every((m) => m.provider === "openrouter")).toBe(true);

      const chat = models.getModel("openrouter", "google/gemini-3-pro-image");
      const image = models.getModelOfType("image", "openrouter", "google/gemini-3-pro-image");
      expect(chat?.api).toBe("openai-completions");
      expect(image?.api).toBe("openrouter-images");

      const [firstImage] = images;
      if (firstImage === undefined) throw new Error("Expected an OpenRouter image model");
      expect((yield* Effect.promise(() => models.getAuth(firstImage)))?.auth.apiKey).toBe("or-key");
      expect((yield* Effect.promise(() => models.getAuth(chat!)))?.auth.apiKey).toBe("or-key");
      expect(provider.generateImages).toBeDefined();
    }),
  );

describe("Models with image models", () => {
  it(
    "supports dynamic providers listing image models via refresh",
    supportsDynamicProvidersListingImageModels,
  );

  it("keeps existing built-in and compat model reads chat-only", keepsExistingBuiltInAndCompat);
});

describe("Models with image models", () => {
  it(
    "builtinModels exposes OpenRouter image models under the openrouter provider",
    builtinmodelsExposesOpenRouterImageModelsUnder,
  );
});
