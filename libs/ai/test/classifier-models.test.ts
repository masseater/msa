import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { createModels, createProvider, getModelType } from "../src/models.ts";
import {
  builtinModels,
  getAllBuiltinModels,
  getBuiltinClassifierModels,
} from "../src/providers/all.ts";
import type { Api, ClassifierApi, ClassifierModel, ClassifierResult, Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import classifierModelsSupport from "./classifier-models-support.ts";

const { context } = classifierModelsSupport;

function classifierModel(provider: string, id: string): ClassifierModel<ClassifierApi> {
  return {
    api: "test-classifier",
    baseUrl: "https://example.test/v1",
    contextWindow: 1000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    name: id,
    provider,
    type: "classifier",
  };
}

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

const OPENCODE_SYSTEM_ONE_URL = "https://opencode.ai/inference/v1/systemone";
const jevModels = getBuiltinClassifierModels("opencode").filter(
  (model) => model.api === "typesafe-system-one",
);

describe("Models with classifier models", () => {
  it("keeps chat and classifier entries with the same provider and id separate", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const chat = chatModel("test", "shared");
        const classifier = classifierModel("test", "shared");
        const provider = createProvider({
          api: {
            "test-chat": {
              stream: () => new AssistantMessageEventStream(),
              streamSimple: () => new AssistantMessageEventStream(),
            },
          },
          auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
          classifiers: {
            "test-classifier": {
              classify: (model): Promise<ClassifierResult> =>
                Promise.resolve({
                  answers: { approved: { probability: 0.9, type: "bool" } },
                  api: model.api,
                  model: model.id,
                  provider: model.provider,
                  stopReason: "stop",
                  timestamp: currentTimeMillis(),
                }),
            },
          },
          id: "test",
          models: [chat, classifier],
        });
        const models = createModels();
        models.setProvider(provider);

        const listedChat = models.getModel("test", "shared");
        expect(listedChat && getModelType(listedChat)).toBe("chat");
        expect(models.getModelOfType("classifier", "test", "shared")?.type).toBe("classifier");
        expect(models.getModelsOfType("classifier")).toEqual([classifier]);
        expect(models.getAllModels()).toHaveLength(2);
        expect(yield* Effect.promise(() => models.getAvailableOfType("classifier"))).toEqual([
          classifier,
        ]);
        expect(
          (yield* Effect.promise(() => models.classify(classifier, context))).answers["approved"],
        ).toEqual({
          probability: 0.9,
          type: "bool",
        });
      }),
    ));
});

describe("Models with classifier models", () => {
  it("rejects chat models at the classifier entry point at runtime", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const chat = chatModel("test", "chat");
        const models = createModels();
        models.setProvider(
          createProvider({
            api: {
              stream: () => new AssistantMessageEventStream(),
              streamSimple: () => new AssistantMessageEventStream(),
            },
            auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
            id: "test",
            models: [chat],
          }),
        );

        const result = yield* Effect.promise(() =>
          models.classify(chat as unknown as ClassifierModel<ClassifierApi>, context),
        );
        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain("is not a classifier model");
      }),
    ));

  it("exposes Jev only through classifier catalog accessors", () => {
    expect(jevModels.length).toBeGreaterThan(0);
    const models = builtinModels();
    for (const jev of jevModels) {
      expect(jev).toMatchObject({ provider: "opencode", type: "classifier" });
      expect(getAllBuiltinModels("opencode")).toContainEqual(jev);
      expect(models.getModel("opencode", jev.id)).toBeUndefined();
      expect(models.getModelOfType("classifier", "opencode", jev.id)).toEqual(jev);
    }
  });
});

describe("Models with classifier models", () => {
  it.each(jevModels.map((model) => ["opencode", model.id, OPENCODE_SYSTEM_ONE_URL] as const))(
    "routes %s Jev (%s) to its TypeSafe-compatible endpoint",
    (provider, id, url) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const models = builtinModels();
          const jev = models.getModelOfType("classifier", provider, id);
          if (jev === undefined) throw new Error(`missing ${provider} Jev model`);
          expect(jev.api).toBe("typesafe-system-one");
          expect(models.getModel(provider, id)).toBeUndefined();

          const requests: Array<{
            url: string;
            body: Record<string, unknown>;
            authorization: string | null;
          }> = [];
          const result = yield* Effect.promise(() =>
            models.classify(jev, context, {
              apiKey: "secret",
              fetch: (input, init) => {
                requests.push({
                  authorization: new Headers(init?.headers).get("authorization"),
                  body: JSON.parse(String(init?.body)) as Record<string, unknown>,
                  url: String(input),
                });
                return Promise.resolve(
                  Response.json({ answers: { approved: { noul: 0.8, type: "noul" } }, model: id }),
                );
              },
            }),
          );

          expect(requests).toEqual([
            {
              authorization: "Bearer secret",
              body: expect.objectContaining({ model: id, state: context.state }),
              url,
            },
          ]);
          expect(result.stopReason).toBe("stop");
          expect(result.answers["approved"]).toEqual({ probability: 0.8, type: "bool" });
        }),
      ),
  );
});

describe("Models with classifier models", () => {
  it("rejects images for classifier models without image input before calling the provider", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const classifier = classifierModel("test", "text-only");
        const classify = vi.fn((): Promise<ClassifierResult> =>
          Promise.resolve({
            answers: {},
            api: classifier.api,
            model: classifier.id,
            provider: classifier.provider,
            stopReason: "stop",
            timestamp: currentTimeMillis(),
          }),
        );
        const models = createModels();
        models.setProvider(
          createProvider({
            auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
            classifiers: { "test-classifier": { classify } },
            id: "test",
            models: [classifier],
          }),
        );

        const result = yield* Effect.promise(() =>
          models.classify(classifier, {
            ...context,
            images: [{ data: "aW1hZ2U=", mimeType: "image/png", type: "image" }],
          }),
        );
        const withoutImages = yield* Effect.promise(() =>
          models.classify(classifier, { ...context, images: [] }),
        );

        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toBe("Model test/text-only does not accept image input");
        expect(withoutImages.stopReason).toBe("stop");
        expect(classify).toHaveBeenCalledOnce();
      }),
    ));
});
