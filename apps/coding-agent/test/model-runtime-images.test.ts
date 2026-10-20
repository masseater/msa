import { type Model, createProvider, isModelType } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import modelRuntimeImagesSupport from "./model-runtime-images-support.ts";

const { classifierContext, context, createRuntime, models, okImageResult, removeRuntimeDirs } =
  modelRuntimeImagesSupport;

const { awaited, runTest } = testing;

afterEach(() => runTest(removeRuntimeDirs));

const listsBuiltInOpenrouterImageModelsSeparately = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* createRuntime();
      const images = runtime.getModelsOfType("image", "openrouter");
      expect(images.length).toBeGreaterThan(0);
      expect(runtime.getModels("openrouter").every((model) => isModelType(model, "chat"))).toBe(
        true,
      );
      const [image] = images;
      if (image === undefined) throw new Error("expected an OpenRouter image model");
      expect(runtime.getModelOfType("image", "openrouter", image.id)).toBe(image);
      expect(runtime.getModel("openrouter", "google/gemini-3-pro-image")?.api).toBe(
        "openai-completions",
      );
      expect(runtime.getModelOfType("image", "openrouter", "google/gemini-3-pro-image")?.type).toBe(
        "image",
      );
      const classifiers = runtime.getModelsOfType("classifier", "openrouter");
      expect(runtime.getAllModels("openrouter").length).toBe(
        runtime.getModels("openrouter").length + images.length + classifiers.length,
      );
    }),
  );

const extensionModelListsReplaceUndeclaredModelsOfPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const runtime = yield* createRuntime();
    const chat: Model<"test-chat"> = {
      api: "test-chat" as const,
      baseUrl: "https://built-in.test/v1",
      contextWindow: 1000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "built-in-chat",
      input: ["text"],
      maxTokens: 100,
      name: "Built-in chat",
      provider: "mixed",
      reasoning: false,
    };
    return { chat, effectRunPromise, runtime };
  });

const extensionModelListsReplaceUndeclaredModelsOf = () =>
  runTest(
    Effect.gen(function* () {
      const { chat, effectRunPromise, runtime } =
        yield* extensionModelListsReplaceUndeclaredModelsOfPart1();
      runtime.registerNativeProvider(
        createProvider({
          auth: {
            apiKey: { name: "Mixed key", resolve: () => effectRunPromise(awaited({ auth: {} })) },
          },
          id: "mixed",
          images: {
            "test-images": {
              generateImages: (model) => effectRunPromise(awaited(okImageResult(model))),
            },
          },
          models: [
            chat,
            models.image("mixed", "built-in-image"),
            models.classifier("mixed", "built-in-classifier"),
          ],
        }),
      );

      runtime.registerProvider("mixed", {
        apiKey: "extension-secret",
        models: [
          {
            ...chat,
            baseUrl: "https://chat-proxy.test/v1",
            id: "extension-chat",
            name: "Extension chat",
          },
        ],
      });

      expect(
        runtime.getAllModels("mixed").map((model) => [model.type ?? "chat", model.id]),
      ).toEqual([["chat", "extension-chat"]]);
      expect(runtime.getModel("mixed", "extension-chat")?.baseUrl).toBe(
        "https://chat-proxy.test/v1",
      );
      expect(runtime.getModelsOfType("image", "mixed")).toEqual([]);
      expect(runtime.getModelsOfType("classifier", "mixed")).toEqual([]);
    }),
  );

const registersExtensionImageAndClassifierModelsWithPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const runtime = yield* createRuntime();
    const observed: Array<{ apiKey: string | undefined; headers: unknown }> = [];
    runtime.registerProvider("extension-operations", {
      apiKey: "extension-secret",
      classifiers: {
        "test-classifier": {
          classify: (model, _context, options) =>
            effectRunPromise(
              Effect.gen(function* () {
                observed.push({ apiKey: options?.apiKey, headers: options?.headers });
                return yield* awaited({
                  answers: { approved: { probability: 0.9, type: "bool" as const } },
                  api: model.api,
                  model: model.id,
                  provider: model.provider,
                  stopReason: "stop" as const,
                  timestamp: 0,
                });
              }),
            ),
        },
      },
      images: {
        "test-images": {
          generateImages: (model, _context, options) =>
            effectRunPromise(
              Effect.gen(function* () {
                observed.push({ apiKey: options?.apiKey, headers: options?.headers });
                return yield* awaited(okImageResult(model));
              }),
            ),
        },
      },
      models: [
        { ...models.image("ignored", "shared"), headers: { "X-Operation": "image" } },
        { ...models.classifier("ignored", "shared"), headers: { "X-Operation": "classifier" } },
      ],
    });
    return { observed, runtime };
  });

const registersExtensionImageAndClassifierModelsWith = () =>
  runTest(
    Effect.gen(function* () {
      const { observed, runtime } = yield* registersExtensionImageAndClassifierModelsWithPart1();

      const image = runtime.getModelOfType("image", "extension-operations", "shared")!;
      const classifier = runtime.getModelOfType("classifier", "extension-operations", "shared")!;
      expect((yield* awaited(runtime.generateImages(image, context))).stopReason).toBe("stop");
      expect((yield* awaited(runtime.classify(classifier, classifierContext))).stopReason).toBe(
        "stop",
      );
      expect(observed).toEqual([
        { apiKey: "extension-secret", headers: { "X-Operation": "image" } },
        { apiKey: "extension-secret", headers: { "X-Operation": "classifier" } },
      ]);
    }),
  );

describe("ModelRuntime image generation", () => {
  it(
    "lists built-in OpenRouter image models separately from chat models",
    listsBuiltInOpenrouterImageModelsSeparately,
  );

  it(
    "extension model lists replace undeclared models of every operation",
    extensionModelListsReplaceUndeclaredModelsOf,
  );

  it(
    "registers extension image and classifier models with their implementations",
    registersExtensionImageAndClassifierModelsWith,
  );
});
