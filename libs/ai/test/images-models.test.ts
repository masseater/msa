import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import modelsModule from "../src/models.ts";
import eventStream from "../src/utils/event-stream.ts";
import imagesModelsSupport from "./images-models-support.ts";

const { createModels, createProvider, getModelType, hasApi, isModelType } = modelsModule;
const { AssistantMessageEventStream } = eventStream;

const { chatModel, fakeAuthContext, imageModel, testProvider } = imagesModelsSupport;
const treatsModelsWithoutATypeAs = () => {
  const chat = chatModel("p", "c");
  const image = imageModel("p", "i");

  expect(chat.type).toBeUndefined();
  expect(getModelType(chat)).toBe("chat");
  expect(getModelType({ ...chat, type: "chat" })).toBe("chat");
  expect(getModelType(image)).toBe("image");
  expect(isModelType(chat, "chat")).toBe(true);
  expect(isModelType(chat, "image")).toBe(false);
  expect(isModelType(image, "image")).toBe(true);

  expect(hasApi({ ...image, api: "test-chat" }, "test-chat")).toBe(false);
  expect(hasApi(chat, "test-chat")).toBe(true);
};

const listsModelsWithoutATypeAs = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const provider = createProvider({
        api: {
          stream: () => new AssistantMessageEventStream(),
          streamSimple: () => new AssistantMessageEventStream(),
        },
        auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
        fetchModels: () => Promise.resolve([chatModel("legacy", "dynamic")]),
        id: "legacy",
        models: [chatModel("legacy", "static"), imageModel("legacy", "static")],
      });
      const models = createModels();
      models.setProvider(provider);

      expect(provider.getModels().map((model) => model.id)).toEqual(["static"]);
      yield* Effect.promise(() => models.refresh({ providers: [provider.id] }));
      expect(provider.getModels().map((model) => model.id)).toEqual(["static", "dynamic"]);
      expect(provider.getModels().map((model) => model.type)).toEqual([undefined, undefined]);
      expect(models.getModelsOfType("image", "legacy").map((model) => model.id)).toEqual([
        "static",
      ]);
    }),
  );

const listsChatImageAndAllModels = () => {
  const models = createModels();
  models.setProvider(
    testProvider({
      id: "p1",
      models: [chatModel("p1", "c1"), imageModel("p1", "i1"), imageModel("p1", "i2")],
    }),
  );
  models.setProvider(testProvider({ id: "p2", models: [imageModel("p2", "i3")] }));

  expect(models.getModels().map((m) => m.id)).toEqual(["c1"]);
  expect(models.getModelsOfType("chat").map((m) => m.id)).toEqual(["c1"]);
  expect(models.getModelsOfType("image").map((m) => m.id)).toEqual(["i1", "i2", "i3"]);
  expect(models.getModelsOfType("image", "p1").map((m) => m.id)).toEqual(["i1", "i2"]);
  expect(models.getModelsOfType("classifier")).toEqual([]);
  expect(models.getAllModels().map((m) => m.id)).toEqual(["c1", "i1", "i2", "i3"]);

  expect(models.getModel("p1", "c1")?.id).toBe("c1");
  expect(models.getModel("p1", "i1")).toBeUndefined();
  expect(models.getModelOfType("chat", "p1", "c1")?.id).toBe("c1");
  expect(models.getModelOfType("image", "p1", "i1")?.id).toBe("i1");
  expect(models.getModelOfType("image", "p1", "c1")).toBeUndefined();
};

const splitsAvailableModelsByType = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const models = createModels({ authContext: fakeAuthContext({ KEY: "k" }) });
      models.setProvider(
        testProvider({
          envVar: "KEY",
          id: "p1",
          models: [chatModel("p1", "c1"), imageModel("p1", "i1")],
        }),
      );
      models.setProvider(
        testProvider({ envVar: "MISSING", id: "p2", models: [imageModel("p2", "i2")] }),
      );

      expect((yield* Effect.promise(() => models.getAvailable())).map((m) => m.id)).toEqual(["c1"]);
      expect(
        (yield* Effect.promise(() => models.getAvailableOfType("chat"))).map((m) => m.id),
      ).toEqual(["c1"]);
      expect(
        (yield* Effect.promise(() => models.getAvailableOfType("image"))).map((m) => m.id),
      ).toEqual(["i1"]);
      expect((yield* Effect.promise(() => models.getAllAvailable())).map((m) => m.id)).toEqual([
        "c1",
        "i1",
      ]);
    }),
  );

describe("model discriminants", () => {
  it("treats models without a type as chat models", treatsModelsWithoutATypeAs);
});

describe("Models with image models", () => {
  it(
    "lists models without a type as chat models at createProvider boundaries",
    listsModelsWithoutATypeAs,
  );
});

describe("Models with image models", () => {
  it("lists chat, image, and all models through typed accessors", listsChatImageAndAllModels);
});

describe("Models with image models", () => {
  it("splits available models by type", splitsAvailableModelsByType);
});
