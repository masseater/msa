import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import modelsModule from "../src/models.ts";
import type modelsTypes from "../src/models.types.ts";
import type typesModule from "../src/types.types.ts";
import eventStream from "../src/utils/event-stream.ts";
import imagesModelsSupport from "./images-models-support.ts";

const { createModels, createProvider } = modelsModule;
const { AssistantMessageEventStream } = eventStream;

const { chatModel, context, fakeAuthContext, imageModel, testProvider } = imagesModelsSupport;

interface GenerateCall {
  model: typesModule.ImageModel<typesModule.ImageApi>;
  options: typesModule.ImagesOptions | undefined;
}

const returnsErrorResultsInsteadOfRejecting = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const models = yield* returnsErrorResultsInsteadOfRejectingStep1();

      models.setProvider(
        testProvider({
          id: "wrong-api",
          images: { "other-images": true },
          models: [imageModel("wrong-api", "i")],
        }),
      );
      const missingApi = yield* Effect.promise(() =>
        models.generateImages(models.getModelOfType("image", "wrong-api", "i")!, context),
      );
      expect(missingApi.stopReason).toBe("error");
      expect(missingApi.errorMessage).toContain(
        'no image generation implementation for "test-images"',
      );
    }),
  );

const rejectsChatModelsAtTheImage = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const models = createModels();
      const chat = chatModel("p1", "chat");
      models.setProvider(testProvider({ id: "p1", images: { "test-chat": true }, models: [chat] }));

      const result = yield* Effect.promise(() =>
        models.generateImages(
          chat as unknown as typesModule.ImageModel<typesModule.ImageApi>,
          context,
        ),
      );
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("is not an image model");
    }),
  );

const rejectsImageModelsAtTheStream = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const models = createModels();
      models.setProvider(testProvider({ id: "p1" }));
      const image = models.getModelOfType("image", "p1", "model-a")!;

      const result = yield* Effect.promise(() =>
        models
          .streamSimple(image as unknown as typesModule.Model<typesModule.Api>, { messages: [] })
          .result(),
      );
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("is not a chat model");
    }),
  );

const requiresAtLeastOneConcreteOperation = () => {
  const createEmptyProvider = (
    implementations: Pick<modelsTypes.CreateProviderOptions, "api" | "images" | "classifiers">,
  ) =>
    createProvider({
      auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
      id: "empty",
      models: [],
      ...implementations,
    });

  const message = 'at least one of "api", "images", or "classifiers"';
  expect(() => createEmptyProvider({})).toThrow(message);
  expect(() => createEmptyProvider({ api: {} })).toThrow(message);
  expect(() => createEmptyProvider({ images: {} })).toThrow(message);
  expect(() => createEmptyProvider({ classifiers: {} })).toThrow(message);
};

const returnsErrorResultsInsteadOfRejectingStep1 = () =>
  Effect.gen(function* () {
    const models = createModels({ authContext: fakeAuthContext({}) });

    const ghost = yield* Effect.promise(() =>
      models.generateImages(imageModel("ghost", "m"), context),
    );
    expect(ghost.stopReason).toBe("error");
    expect(ghost.errorMessage).toContain("Unknown provider: ghost");

    const calls: GenerateCall[] = [];
    models.setProvider(testProvider({ calls, envVar: "MISSING", id: "p1" }));
    const model = models.getModelOfType("image", "p1", "model-a")!;
    expect(yield* Effect.promise(() => models.getAuth(model))).toBeUndefined();
    const unconfigured = yield* Effect.promise(() => models.generateImages(model, context));
    expect(unconfigured.stopReason).toBe("error");
    expect(unconfigured.errorMessage).toContain("not configured");
    expect(calls).toEqual([]);

    const controllerSignal = AbortSignal.abort();
    const cancelled = yield* Effect.promise(() =>
      models.generateImages(model, context, { signal: controllerSignal }),
    );
    expect(cancelled.stopReason).toBe("aborted");
    expect(calls).toEqual([]);

    models.setProvider(
      createProvider({
        api: {
          stream: () => new AssistantMessageEventStream(),
          streamSimple: () => new AssistantMessageEventStream(),
        },
        auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
        id: "chat-only",
        models: [imageModel("chat-only", "i")],
      }),
    );
    const unsupported = yield* Effect.promise(() =>
      models.generateImages(models.getModelOfType("image", "chat-only", "i")!, context),
    );
    expect(unsupported.stopReason).toBe("error");
    expect(unsupported.errorMessage).toContain("does not support image generation");
    return models;
  });

describe("Models with image models", () => {
  it("returns error results instead of rejecting", returnsErrorResultsInsteadOfRejecting);
});

describe("Models with image models", () => {
  it("rejects chat models at the image entry point at runtime", rejectsChatModelsAtTheImage);

  it("rejects image models at the stream entry points at runtime", rejectsImageModelsAtTheStream);
});

describe("Models with image models", () => {
  it(
    "requires at least one concrete operation implementation",
    requiresAtLeastOneConcreteOperation,
  );
});
