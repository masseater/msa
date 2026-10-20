import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { getModel as getCompatModel } from "../src/compat.ts";
import { InMemoryModelsStore, type ModelsStoreEntry } from "../src/models-store.ts";
import {
  type Provider,
  createModels,
  createProvider,
  getModelType,
  hasApi,
  isModelType,
  modelsAreEqual,
} from "../src/models.ts";
import { getBuiltinModel } from "../src/providers/all.ts";
import { fauxAssistantMessage, fauxProvider } from "../src/providers/faux.ts";
import { OPENAI_MODELS } from "../src/providers/openai.models.ts";
import type { Api, ImageApi, ImageModel, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

function chatModel(provider: string, id: string): Model<Api> {
  return {
    api: "test-chat",
    baseUrl: "https://example.test/v1",
    contextWindow: 1000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 100,
    name: id,
    provider,
    reasoning: false,
  };
}

function imageModel(provider: string, id: string): ImageModel<ImageApi> {
  return {
    api: "test-images",
    baseUrl: "https://example.test/v1",
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    name: id,
    output: ["image"],
    provider,
    type: "image",
  };
}

const noAuth = { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } };
const chatStreams = {
  stream: () => new AssistantMessageEventStream(),
  streamSimple: () => new AssistantMessageEventStream(),
};

describe("chat models without a type", () => {
  it("work through a handwritten provider without getAllModels", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const faux = fauxProvider({ provider: "handwritten" });
        const handwritten: Provider = {
          auth: faux.provider.auth,
          getModels: () => faux.models,
          id: "handwritten",
          name: "Handwritten",
          stream: faux.provider.stream,
          streamSimple: faux.provider.streamSimple,
        };
        const models = createModels();
        models.setProvider(handwritten);

        const model = models.getModel("handwritten", faux.models[0].id);
        expect(model).toBeDefined();
        expect(model?.type).toBeUndefined();
        expect(getModelType(model!)).toBe("chat");
        expect(hasApi(model!, model!.api)).toBe(true);
        expect(modelsAreEqual(model, { ...model!, type: "chat" })).toBe(true);
        expect(modelsAreEqual(model, { ...imageModel(model!.provider, model!.id) })).toBe(false);
        expect(models.getModelsOfType("chat", "handwritten")).toEqual(faux.models);
        expect(models.getAllModels("handwritten")).toEqual(faux.models);
        expect(models.getModelsOfType("image", "handwritten")).toEqual([]);

        faux.setResponses([fauxAssistantMessage("hi")]);
        const result = yield* Effect.promise(() =>
          models.complete(model!, {
            messages: [{ content: "hi", role: "user", timestamp: 0 }],
          }),
        );
        expect(result.stopReason).toBe("stop");
      }),
    ));
});

describe("chat models without a type", () => {
  it("narrow mixed lists with isModelType", () => {
    const mixed = [
      chatModel("p", "c"),
      { ...chatModel("p", "typed"), type: "chat" as const },
      imageModel("p", "i"),
    ];
    expect(mixed.filter((model) => isModelType(model, "chat")).map((model) => model.id)).toEqual([
      "c",
      "typed",
    ]);
    expect(mixed.filter((model) => isModelType(model, "image")).map((model) => model.id)).toEqual([
      "i",
    ]);
    expect(mixed.filter((model) => isModelType(model, "classifier"))).toEqual([]);
  });
});

describe("built-in catalog getters", () => {
  it("return model shapes that can be reassigned within one api", () => {
    const [first, second] = Object.keys(OPENAI_MODELS).filter(
      (id): id is keyof typeof OPENAI_MODELS => id in OPENAI_MODELS,
    );
    if (first === undefined || second === undefined) throw new Error("Expected two OpenAI models");
    let model = getBuiltinModel("openai", first);
    expect(model.id).toBe(first);
    model = getBuiltinModel("openai", second);
    let compat = getCompatModel("openai", first);
    expect(compat.id).toBe(first);
    compat = getCompatModel("openai", second);

    expect(model.id).toBe(second);
    expect(compat.id).toBe(second);
  });
});

describe("stored and fetched models of unknown types", () => {
  it("are dropped instead of failing the refresh", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const modelsStore = new InMemoryModelsStore();
        const stored = {
          models: [
            chatModel("dyn", "stored-chat"),
            imageModel("dyn", "stored-image"),
            { ...chatModel("dyn", "future-embedding"), type: "embedding" },
            { ...imageModel("dyn", "future-video"), type: "video" },
          ],
        } as unknown as ModelsStoreEntry;
        yield* Effect.promise(() => modelsStore.write("dyn", stored));

        let fetched: unknown[] = [];
        const models = createModels({ modelsStore });
        models.setProvider(
          createProvider({
            api: chatStreams,
            auth: noAuth,
            fetchModels: () => Promise.resolve(fetched as Model<Api>[]),
            id: "dyn",
            models: [],
          }),
        );

        const restored = yield* Effect.promise(() =>
          models.refresh({ allowNetwork: false, providers: ["dyn"] }),
        );
        expect(restored.errors.size).toBe(0);
        expect(models.getAllModels("dyn").map((model) => model.id)).toEqual([
          "stored-chat",
          "stored-image",
        ]);

        fetched = [
          chatModel("dyn", "fetched-chat"),
          { ...imageModel("dyn", "fetched-video"), type: "video" },
        ];
        const refreshed = yield* Effect.promise(() => models.refresh({ providers: ["dyn"] }));
        expect(refreshed.errors.size).toBe(0);
        expect(models.getAllModels("dyn").map((model) => model.id)).toEqual(["fetched-chat"]);
        expect(yield* Effect.promise(() => modelsStore.read("dyn"))).toMatchObject({
          models: [{ id: "fetched-chat" }],
        });
      }),
    ));
});
