import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels, createProvider, getModelType } from "../src/models.ts";
import {
  builtinModels,
  getAllBuiltinModels,
  getBuiltinClassifierModel,
  getBuiltinClassifierModels,
} from "../src/providers/all.ts";
import type {
  Api,
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierResult,
  Model,
} from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

function classifierModel(provider: string, id: string): ClassifierModel<ClassifierApi> {
  return {
    type: "classifier",
    id,
    name: id,
    api: "test-classifier",
    provider,
    baseUrl: "https://example.test/v1",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
  };
}

function chatModel(provider: string, id: string): Model<Api> {
  return {
    id,
    name: id,
    api: "test-chat",
    provider,
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

const context: ClassifierContext = {
  state: { text: "yes" },
  questions: {
    approved: {
      type: "bool",
      instructions: "Does this express approval?",
      criteria: { true: "Approval", false: "No approval" },
    },
  },
};

describe("Models with classifier models", () => {
  it("keeps chat and classifier entries with the same provider and id separate", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const chat = chatModel("test", "shared");
        const classifier = classifierModel("test", "shared");
        const provider = createProvider({
          id: "test",
          auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
          models: [chat, classifier],
          api: {
            "test-chat": {
              stream: () => new AssistantMessageEventStream(),
              streamSimple: () => new AssistantMessageEventStream(),
            },
          },
          classifiers: {
            "test-classifier": {
              classify: (model): Promise<ClassifierResult> =>
                Promise.resolve({
                  api: model.api,
                  provider: model.provider,
                  model: model.id,
                  answers: { approved: { type: "bool", probability: 0.9 } },
                  stopReason: "stop",
                  timestamp: currentTimeMillis(),
                }),
            },
          },
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
          type: "bool",
          probability: 0.9,
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
            id: "test",
            auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
            models: [chat],
            api: {
              stream: () => new AssistantMessageEventStream(),
              streamSimple: () => new AssistantMessageEventStream(),
            },
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
    const jev = getBuiltinClassifierModel("typesafe", "jev-latest");
    expect(jev).toMatchObject({
      type: "classifier",
      api: "typesafe-system-one",
      provider: "typesafe",
      contextWindow: 64000,
    });
    expect(getBuiltinClassifierModels("typesafe")).toEqual([jev]);
    expect(getAllBuiltinModels("typesafe")).toEqual([jev]);

    const models = builtinModels();
    expect(models.getModel("typesafe", "jev-latest")).toBeUndefined();
    expect(models.getModelOfType("classifier", "typesafe", "jev-latest")).toEqual(jev);
  });
});

describe("Models with classifier models", () => {
  it.each([
    ["vercel-ai-gateway", "typesafe-ai/jev", "https://ai-gateway.vercel.sh/typesafe/v1/systemone"],
    ["opencode", "jev-1.13", "https://opencode.ai/inference/v1/systemone"],
    ["opencode", "jev-1.13-free", "https://opencode.ai/inference/v1/systemone"],
  ])("routes %s Jev (%s) to its TypeSafe-compatible endpoint", (provider, id, url) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const models = builtinModels();
        const jev = models.getModelOfType("classifier", provider, id);
        if (jev === undefined) throw new Error(`missing ${provider} Jev model`);
        expect(jev).toMatchObject({ api: "typesafe-system-one", contextWindow: 32000 });
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
                url: String(input),
                body: JSON.parse(String(init?.body)) as Record<string, unknown>,
                authorization: new Headers(init?.headers).get("authorization"),
              });
              return Promise.resolve(
                Response.json({ model: id, answers: { approved: { type: "noul", noul: 0.8 } } }),
              );
            },
          }),
        );

        expect(requests).toEqual([
          {
            url,
            body: expect.objectContaining({ model: id, state: context.state }),
            authorization: "Bearer secret",
          },
        ]);
        expect(result.stopReason).toBe("stop");
        expect(result.answers["approved"]).toEqual({ type: "bool", probability: 0.8 });
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
            api: classifier.api,
            provider: classifier.provider,
            model: classifier.id,
            answers: {},
            stopReason: "stop",
            timestamp: currentTimeMillis(),
          }),
        );
        const models = createModels();
        models.setProvider(
          createProvider({
            id: "test",
            auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
            models: [classifier],
            classifiers: { "test-classifier": { classify } },
          }),
        );

        const result = yield* Effect.promise(() =>
          models.classify(classifier, {
            ...context,
            images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
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

describe("Models with classifier models", () => {
  it("routes OpenAI GPT-6 Luna through the Decisions API with images", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const models = builtinModels();
        const luna = models.getModelOfType("classifier", "openai", "gpt-6-luna");
        if (luna === undefined) throw new Error("missing OpenAI Decisions model");
        expect(luna).toMatchObject({
          api: "openai-decisions",
          input: ["text", "image"],
          contextWindow: 922000,
        });
        expect(models.getModel("openai", "gpt-6-luna")?.api).toBe("openai-responses");

        const urls: string[] = [];
        const result = yield* Effect.promise(() =>
          models.classify(
            luna,
            { ...context, images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }] },
            {
              apiKey: "secret",
              fetch: (input) => {
                urls.push(String(input));
                return Promise.resolve(
                  Response.json({
                    answers: [{ type: "predicate", name: "approved", probability: 0.8 }],
                  }),
                );
              },
            },
          ),
        );

        expect(urls).toEqual(["https://api.openai.com/v1/decisions"]);
        expect(result.stopReason).toBe("stop");
        expect(result.answers["approved"]).toEqual({ type: "bool", probability: 0.8 });
      }),
    ));
});

describe("Models with classifier models", () => {
  it("lists OpenAI Decisions models only for API key credentials", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const apiKeyStore = new InMemoryCredentialStore();
        yield* Effect.promise(() =>
          apiKeyStore.modify("openai", () => Promise.resolve({ type: "api_key", key: "secret" })),
        );
        const oauthStore = new InMemoryCredentialStore();
        yield* Effect.promise(() =>
          oauthStore.modify("openai", () =>
            Promise.resolve({
              type: "oauth",
              access: "access",
              refresh: "refresh",
              expires: currentTimeMillis() + 3_600_000,
            }),
          ),
        );

        const withApiKey = builtinModels({ credentials: apiKeyStore });
        const withOAuth = builtinModels({ credentials: oauthStore });

        expect(
          (yield* Effect.promise(() => withApiKey.getAvailableOfType("classifier", "openai"))).map(
            (model) => model.id,
          ),
        ).toEqual(["gpt-6-luna"]);
        expect(
          yield* Effect.promise(() => withOAuth.getAvailableOfType("classifier", "openai")),
        ).toEqual([]);
        expect(
          (yield* Effect.promise(() => withOAuth.getAvailable("openai"))).some(
            (model) => model.id === "gpt-6-luna",
          ),
        ).toBe(true);
      }),
    ));

  it("routes OpenRouter classifier models through the System One API", () => {
    const models = builtinModels();
    for (const model of getBuiltinClassifierModels("openrouter")) {
      expect(model).toMatchObject({
        api: "typesafe-system-one",
        baseUrl: "https://openrouter.ai/api/v1",
      });
      expect(models.getModel("openrouter", model.id)).toBeUndefined();
      expect(models.getModelOfType("classifier", "openrouter", model.id)).toEqual(model);
    }
  });
});
