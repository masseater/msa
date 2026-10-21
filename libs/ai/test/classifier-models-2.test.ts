import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import credentialStore from "../src/auth/credential-store.ts";
import all from "../src/providers/all.ts";
import clock from "../src/utils/clock.ts";
import classifierModelsSupport from "./classifier-models-support.ts";

const { builtinModels, getBuiltinClassifierModels } = all;
const { InMemoryCredentialStore } = credentialStore;
const { currentTimeMillis } = clock;

const { context } = classifierModelsSupport;

describe("Models with classifier models", () => {
  it("routes OpenAI Decisions classifiers with images", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const models = builtinModels();
        const decisionsModel = models
          .getModelsOfType("classifier", "openai")
          .find((model) => model.api === "openai-decisions" && model.input.includes("image"));
        if (decisionsModel === undefined) throw new Error("missing OpenAI Decisions model");
        expect(decisionsModel.contextWindow).toBeGreaterThan(0);
        expect(models.getModel("openai", decisionsModel.id)?.api).toBe("openai-responses");

        const urls: string[] = [];
        const result = yield* Effect.promise(() =>
          models.classify(
            decisionsModel,
            { ...context, images: [{ data: "aW1hZ2U=", mimeType: "image/png", type: "image" }] },
            {
              apiKey: "secret",
              fetch: (input) => {
                urls.push(String(input));
                return Promise.resolve(
                  Response.json({
                    answers: [{ name: "approved", probability: 0.8, type: "predicate" }],
                  }),
                );
              },
            },
          ),
        );

        expect(urls).toEqual(["https://api.openai.com/v1/decisions"]);
        expect(result.stopReason).toBe("stop");
        expect(result.answers["approved"]).toEqual({ probability: 0.8, type: "bool" });
      }),
    ));
});

describe("Models with classifier models", () => {
  it("lists OpenAI Decisions models only for API key credentials", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const apiKeyStore = new InMemoryCredentialStore();
        yield* Effect.promise(() =>
          apiKeyStore.modify("openai", () => Promise.resolve({ key: "secret", type: "api_key" })),
        );
        const oauthStore = new InMemoryCredentialStore();
        yield* Effect.promise(() =>
          oauthStore.modify("openai", () =>
            Promise.resolve({
              access: "access",
              expires: currentTimeMillis() + 3_600_000,
              refresh: "refresh",
              type: "oauth",
            }),
          ),
        );

        const decisionsModelIds = getBuiltinClassifierModels("openai").map((model) => model.id);
        expect(decisionsModelIds.length).toBeGreaterThan(0);
        const withApiKey = builtinModels({ credentials: apiKeyStore });
        const withOAuth = builtinModels({ credentials: oauthStore });

        expect(
          (yield* Effect.promise(() => withApiKey.getAvailableOfType("classifier", "openai"))).map(
            (model) => model.id,
          ),
        ).toEqual(decisionsModelIds);
        expect(
          yield* Effect.promise(() => withOAuth.getAvailableOfType("classifier", "openai")),
        ).toEqual([]);
        expect(
          (yield* Effect.promise(() => withOAuth.getAvailable("openai"))).some((model) =>
            decisionsModelIds.includes(model.id),
          ),
        ).toBe(true);
      }),
    ));
});

describe("Models with classifier models", () => {
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
