import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { builtinModels, getBuiltinClassifierModels } from "../src/providers/all.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import classifierModelsSupport from "./classifier-models-support.ts";

const { context } = classifierModelsSupport;

describe("Models with classifier models", () => {
  it("routes OpenAI GPT-6 Luna through the Decisions API with images", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const models = builtinModels();
        const luna = models.getModelOfType("classifier", "openai", "gpt-6-luna");
        if (luna === undefined) throw new Error("missing OpenAI Decisions model");
        expect(luna).toMatchObject({
          api: "openai-decisions",
          contextWindow: 922000,
          input: ["text", "image"],
        });
        expect(models.getModel("openai", "gpt-6-luna")?.api).toBe("openai-responses");

        const urls: string[] = [];
        const result = yield* Effect.promise(() =>
          models.classify(
            luna,
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
