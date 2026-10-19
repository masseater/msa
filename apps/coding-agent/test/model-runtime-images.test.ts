import { createProvider, isModelType, type Model } from "@msa/ai";
import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  classifierContext,
  context,
  createRuntime,
  models,
  okImageResult,
  removeRuntimeDirs,
} from "./model-runtime-images-support.ts";

afterEach(() => runTest(removeRuntimeDirs));

describe("ModelRuntime image generation", () => {
  it("lists built-in OpenRouter image models separately from chat models", () =>
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
        expect(
          runtime.getModelOfType("image", "openrouter", "google/gemini-3-pro-image")?.type,
        ).toBe("image");
        const classifiers = runtime.getModelsOfType("classifier", "openrouter");
        expect(runtime.getAllModels("openrouter").length).toBe(
          runtime.getModels("openrouter").length + images.length + classifiers.length,
        );
      }),
    ));

  it("extension model lists replace undeclared models of every operation", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* createRuntime();
        const chat: Model<"test-chat"> = {
          id: "built-in-chat",
          name: "Built-in chat",
          api: "test-chat" as const,
          provider: "mixed",
          baseUrl: "https://built-in.test/v1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1000,
          maxTokens: 100,
        };
        runtime.registerNativeProvider(
          createProvider({
            id: "mixed",
            auth: {
              apiKey: { name: "Mixed key", resolve: () => effectRunPromise(awaited({ auth: {} })) },
            },
            models: [
              chat,
              models.image("mixed", "built-in-image"),
              models.classifier("mixed", "built-in-classifier"),
            ],
            images: {
              "test-images": {
                generateImages: (model) => effectRunPromise(awaited(okImageResult(model))),
              },
            },
          }),
        );

        runtime.registerProvider("mixed", {
          apiKey: "extension-secret",
          models: [
            {
              ...chat,
              id: "extension-chat",
              name: "Extension chat",
              baseUrl: "https://chat-proxy.test/v1",
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
    ));

  it("registers extension image and classifier models with their implementations", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* createRuntime();
        const observed: Array<{ apiKey: string | undefined; headers: unknown }> = [];
        runtime.registerProvider("extension-operations", {
          apiKey: "extension-secret",
          models: [
            { ...models.image("ignored", "shared"), headers: { "X-Operation": "image" } },
            { ...models.classifier("ignored", "shared"), headers: { "X-Operation": "classifier" } },
          ],
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
          classifiers: {
            "test-classifier": {
              classify: (model, _context, options) =>
                effectRunPromise(
                  Effect.gen(function* () {
                    observed.push({ apiKey: options?.apiKey, headers: options?.headers });
                    return yield* awaited({
                      api: model.api,
                      provider: model.provider,
                      model: model.id,
                      answers: { approved: { type: "bool" as const, probability: 0.9 } },
                      stopReason: "stop" as const,
                      timestamp: 0,
                    });
                  }),
                ),
            },
          },
        });

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
    ));
});
