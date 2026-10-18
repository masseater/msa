import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  type AnyModel,
  type Api,
  type AssistantImages,
  type ClassifierModel,
  createProvider,
  type ImageModel,
  type ImagesOptions,
  InMemoryModelsStore,
  isModelType,
  type Model,
} from "@msa/ai";
import {
  awaited,
  runTest,
  abortController,
  toJsonText,
  writeTextFile,
  joinPath,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

function imageModel(provider: string, id: string): ImageModel<"test-images"> {
  return {
    type: "image" as const,
    id,
    name: id,
    api: "test-images" as const,
    provider,
    baseUrl: "https://images.test/v1",
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function classifierModel(provider: string, id: string): ClassifierModel<"test-classifier"> {
  return {
    type: "classifier" as const,
    id,
    name: id,
    api: "test-classifier" as const,
    provider,
    baseUrl: "https://classifier.test/v1",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
  };
}

const context = { input: [{ type: "text" as const, text: "a red circle" }] };
const classifierContext = {
  state: { text: "Looks good" },
  questions: {
    approved: {
      type: "bool" as const,
      instructions: "Does this express approval?",
      criteria: { true: "Approval", false: "No approval" },
    },
  },
};

function okImageResult(model: ImageModel<string>): AssistantImages {
  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output: [{ type: "image" as const, data: "aGk=", mimeType: "image/png" }],
    stopReason: "stop" as const,
    timestamp: 0,
  };
}

describe("ModelRuntime image generation", () => {
  const tempDirs: string[] = [];
  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        for (const dir of tempDirs.splice(0)) yield* removePath(dir);
      }),
    ),
  );

  function createRuntime(modelsJson?: object): Promise<ModelRuntime> {
    return runTest(
      Effect.gen(function* () {
        let modelsPath: string | null = null;
        if (modelsJson !== undefined) {
          const dir = mkdtempSync(joinPath(tmpdir(), "msa-images-"));
          tempDirs.push(dir);
          modelsPath = joinPath(dir, "models.json");
          yield* writeTextFile(modelsPath, yield* toJsonText(modelsJson));
        }
        return yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsStore: new InMemoryModelsStore(),
            modelsPath,
            allowModelNetwork: false,
          }),
        );
      }),
    );
  }

  it("lists built-in OpenRouter image models separately from chat models", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(createRuntime());
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

        const runtime = yield* awaited(createRuntime());
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
              imageModel("mixed", "built-in-image"),
              classifierModel("mixed", "built-in-classifier"),
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

        const runtime = yield* awaited(createRuntime());
        const observed: Array<{ apiKey: string | undefined; headers: unknown }> = [];
        runtime.registerProvider("extension-operations", {
          apiKey: "extension-secret",
          models: [
            { ...imageModel("ignored", "shared"), headers: { "X-Operation": "image" } },
            { ...classifierModel("ignored", "shared"), headers: { "X-Operation": "classifier" } },
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

  it("generates images through a native provider with runtime-resolved auth", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* awaited(createRuntime());
        const calls: Array<{ model: AnyModel; options: ImagesOptions | undefined }> = [];
        runtime.registerNativeProvider(
          createProvider({
            id: "pixels",
            auth: {
              apiKey: {
                name: "Pixels key",
                resolve: ({ credential }) =>
                  effectRunPromise(
                    awaited(
                      credential?.key !== undefined && credential?.key.length > 0
                        ? { auth: { apiKey: credential.key }, source: "stored" }
                        : undefined,
                    ),
                  ),
              },
            },
            models: [imageModel("pixels", "flux")],
            images: {
              "test-images": {
                generateImages: (model, _context, options) =>
                  effectRunPromise(
                    Effect.gen(function* () {
                      calls.push({ model, options });
                      return yield* awaited({
                        api: model.api,
                        provider: model.provider,
                        model: model.id,
                        output: [{ type: "image" as const, data: "aGk=", mimeType: "image/png" }],
                        stopReason: "stop" as const,
                        timestamp: 0,
                      });
                    }),
                  ),
              },
            },
          }),
        );
        const model = runtime.getModelOfType("image", "pixels", "flux")!;

        const unconfigured = yield* awaited(runtime.generateImages(model, context));
        expect(unconfigured.stopReason).toBe("error");
        expect(unconfigured.errorMessage).toContain("not configured");
        expect(calls).toEqual([]);

        const controller = abortController();
        controller.abort();
        const cancelled = yield* awaited(
          runtime.generateImages(model, context, { signal: controller.signal }),
        );
        expect(cancelled.stopReason).toBe("aborted");
        expect(calls).toEqual([]);

        yield* awaited(runtime.setRuntimeApiKey("pixels", "sk-pixels"));
        expect(
          (yield* awaited(runtime.getAvailableOfType("image", "pixels"))).map((entry) => entry.id),
        ).toEqual(["flux"]);
        const result = yield* awaited(runtime.generateImages(model, context));
        expect(result.stopReason).toBe("stop");
        expect(calls[0]?.options?.apiKey).toBe("sk-pixels");
      }),
    ));

  it("rejects image models at every chat entry point before provider dispatch", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* awaited(createRuntime());
        let chatDispatches = 0;
        const rejectDispatch = (): never => {
          chatDispatches++;
          throw new Error("image reached chat adapter");
        };
        runtime.registerNativeProvider(
          createProvider({
            id: "hybrid",
            auth: {
              apiKey: {
                name: "Hybrid key",
                resolve: ({ credential }) =>
                  effectRunPromise(
                    awaited(
                      credential?.key !== undefined && credential?.key.length > 0
                        ? { auth: { apiKey: credential.key }, source: "stored" }
                        : undefined,
                    ),
                  ),
              },
            },
            models: [imageModel("hybrid", "shared")],
            api: {
              stream: rejectDispatch,
              streamSimple: rejectDispatch,
              fetchDeferred: rejectDispatch,
              cancelDeferred: () => effectRunPromise(awaited(rejectDispatch())),
            },
          }),
        );
        yield* awaited(runtime.setRuntimeApiKey("hybrid", "sk-hybrid"));
        const image = runtime.getModelOfType("image", "hybrid", "shared")!;
        const chat = image as unknown as Model<Api>;
        const chatContext = { messages: [] };
        const handle = { provider: "hybrid", modelId: image.id, api: image.api, id: "response-1" };

        const results = [
          yield* awaited(runtime.stream(chat, chatContext).result()),
          yield* awaited(runtime.complete(chat, chatContext)),
          yield* awaited(runtime.streamSimple(chat, chatContext).result()),
          yield* awaited(runtime.completeSimple(chat, chatContext)),
          yield* awaited(runtime.streamDeferred(chat, handle).result()),
          yield* awaited(runtime.fetchDeferred(chat, handle)),
        ];
        for (const result of results) {
          expect(result.stopReason).toBe("error");
          expect(result.errorMessage).toContain("is not a chat model");
        }
        yield* awaited(
          expect(runtime.cancelDeferred(chat, handle)).rejects.toThrow("is not a chat model"),
        );
        expect(chatDispatches).toBe(0);
      }),
    ));

  it("keeps image generation on a built-in provider composed with models.json overrides", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          createRuntime({
            providers: {
              openrouter: {
                headers: { "X-Title": "msa" },
                modelOverrides: {
                  "openrouter/auto": { name: "Auto (renamed)" },
                  "google/gemini-3-pro-image": { headers: { "X-Chat-Only": "yes" } },
                },
              },
            },
          }),
        );
        const provider = runtime.getProvider("openrouter")!;
        expect(provider.generateImages).toBeDefined();
        expect(runtime.getModel("openrouter", "openrouter/auto")?.name).toBe("Auto (renamed)");
        expect(runtime.getModelsOfType("image", "openrouter").length).toBeGreaterThan(0);

        yield* awaited(runtime.setRuntimeApiKey("openrouter", "sk-or"));
        const chat = runtime.getModel("openrouter", "google/gemini-3-pro-image")!;
        const image = runtime.getModelOfType("image", "openrouter", "google/gemini-3-pro-image")!;
        const chatAuth = yield* awaited(runtime.getAuth(chat));
        const imageAuth = yield* awaited(runtime.getAuth(image));
        expect(imageAuth?.auth.apiKey).toBe("sk-or");
        expect(chatAuth?.auth.headers).toMatchObject({ "X-Title": "msa", "X-Chat-Only": "yes" });
        expect(imageAuth?.auth.headers).toEqual({ "X-Title": "msa" });
      }),
    ));

  it("does not add image generation or classification to composed chat-only providers", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          createRuntime({
            providers: { anthropic: { headers: { "X-Title": "msa" } } },
          }),
        );
        const provider = runtime.getProvider("anthropic")!;
        expect(provider.generateImages).toBeUndefined();
        expect(provider.classify).toBeUndefined();
        expect(runtime.getProvider("openrouter")?.generateImages).toBeDefined();
        expect(runtime.getProvider("opencode")?.classify).toBeDefined();
      }),
    ));
});
