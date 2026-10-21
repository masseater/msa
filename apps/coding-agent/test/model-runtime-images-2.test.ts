import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import modelRuntimeImagesSupport from "./model-runtime-images-support.ts";

const { createProvider } = ai;

const { context, createRuntime, models, removeRuntimeDirs } = modelRuntimeImagesSupport;

const { abortController, awaited, failure, runTest } = testing;

afterEach(() => runTest(removeRuntimeDirs));

const storedAuth = (key: string | undefined) =>
  key === undefined || key === ""
    ? undefined
    : { auth: { apiKey: key }, source: "stored" as const };

const generatesImagesThroughANativeProviderWithSetup = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const runtime = yield* createRuntime();
    const calls: Array<{ model: aiTypes.AnyModel; options: aiTypes.ImagesOptions | undefined }> =
      [];
    runtime.registerNativeProvider(
      createProvider({
        auth: {
          apiKey: {
            name: "Pixels key",
            resolve: ({ credential }) => effectRunPromise(awaited(storedAuth(credential?.key))),
          },
        },
        id: "pixels",
        images: {
          "test-images": {
            generateImages: (model, _context, options) =>
              effectRunPromise(
                Effect.gen(function* () {
                  calls.push({ model, options });
                  return yield* awaited({
                    api: model.api,
                    model: model.id,
                    output: [{ data: "aGk=", mimeType: "image/png", type: "image" as const }],
                    provider: model.provider,
                    stopReason: "stop" as const,
                    timestamp: 0,
                  });
                }),
              ),
          },
        },
        models: [models.image("pixels", "flux")],
      }),
    );
    return { calls, runtime };
  });

const generatesImagesThroughANativeProviderWith = Effect.gen(function* () {
  const { calls, runtime } = yield* generatesImagesThroughANativeProviderWithSetup();
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
});

const rejectsImageModelsAtEveryChatEntry = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const runtime = yield* createRuntime();
  let chatDispatches = 0;
  const rejectDispatch = (): never => {
    chatDispatches++;
    throw new Error("image reached chat adapter");
  };
  runtime.registerNativeProvider(
    createProvider({
      api: {
        cancelDeferred: () => effectRunPromise(awaited(rejectDispatch())),
        fetchDeferred: rejectDispatch,
        stream: rejectDispatch,
        streamSimple: rejectDispatch,
      },
      auth: {
        apiKey: {
          name: "Hybrid key",
          resolve: ({ credential }) => effectRunPromise(awaited(storedAuth(credential?.key))),
        },
      },
      id: "hybrid",
      models: [models.image("hybrid", "shared")],
    }),
  );
  yield* awaited(runtime.setRuntimeApiKey("hybrid", "sk-hybrid"));
  const image = runtime.getModelOfType("image", "hybrid", "shared")!;
  const chat = image as unknown as aiTypes.Model<aiTypes.Api>;
  const chatContext = { messages: [] };
  const handle = { api: image.api, id: "response-1", modelId: image.id, provider: "hybrid" };

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
  expect(yield* failure(awaited(runtime.cancelDeferred(chat, handle)))).toMatchObject({
    message: expect.stringContaining("is not a chat model"),
  });
  expect(chatDispatches).toBe(0);
});

const keepsImageGenerationOnABuiltIn = Effect.gen(function* () {
  const runtime = yield* createRuntime({
    providers: {
      openrouter: {
        headers: { "X-Title": "msa" },
        modelOverrides: {
          "google/gemini-3-pro-image": { headers: { "X-Chat-Only": "yes" } },
          "openrouter/auto": { name: "Auto (renamed)" },
        },
      },
    },
  });
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
  expect(chatAuth?.auth.headers).toMatchObject({ "X-Chat-Only": "yes", "X-Title": "msa" });
  expect(imageAuth?.auth.headers).toEqual({ "X-Title": "msa" });
});

const doesNotAddImageGenerationOrClassification = Effect.gen(function* () {
  const runtime = yield* createRuntime({
    providers: { "anthropic-api": { headers: { "X-Title": "msa" } } },
  });
  const provider = runtime.getProvider("anthropic-api")!;
  expect(provider.generateImages).toBeUndefined();
  expect(provider.classify).toBeUndefined();
  expect(runtime.getProvider("openrouter")?.generateImages).toBeDefined();
  expect(runtime.getProvider("opencode")?.classify).toBeDefined();
});

describe("ModelRuntime image generation", () => {
  it("generates images through a native provider with runtime-resolved auth", () =>
    runTest(generatesImagesThroughANativeProviderWith));

  it("rejects image models at every chat entry point before provider dispatch", () =>
    runTest(rejectsImageModelsAtEveryChatEntry));

  it("keeps image generation on a built-in provider composed with models.json overrides", () =>
    runTest(keepsImageGenerationOnABuiltIn));

  it("does not add image generation or classification to composed chat-only providers", () =>
    runTest(doesNotAddImageGenerationOrClassification));
});
