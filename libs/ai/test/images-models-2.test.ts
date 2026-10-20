import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createModels, createProvider } from "../src/models.ts";
import type { ImageApi, ImageModel, ImagesOptions } from "../src/types.ts";
import imagesModelsSupport from "./images-models-support.ts";

const { context, fakeAuthContext, imageModel, okResult, testProvider } = imagesModelsSupport;

interface GenerateCall {
  model: ImageModel<ImageApi>;
  options: ImagesOptions | undefined;
}

const resolvesAuthThroughTheProviderAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: GenerateCall[] = [];
      const models = createModels({ authContext: fakeAuthContext({ TEST_KEY: "env-key" }) });
      models.setProvider(testProvider({ calls, envVar: "TEST_KEY", id: "p1" }));
      const model = models.getModelOfType("image", "p1", "model-a")!;

      expect((yield* Effect.promise(() => models.getAuth(model)))?.auth.apiKey).toBe("env-key");
      expect((yield* Effect.promise(() => models.getAuth(model.provider)))?.auth.apiKey).toBe(
        "env-key",
      );
      expect(
        (yield* Effect.promise(() => models.getAuth(model, { apiKey: "explicit-key" })))?.auth
          .apiKey,
      ).toBe("explicit-key");

      const result = yield* Effect.promise(() => models.generateImages(model, context));
      expect(result.stopReason).toBe("stop");
      expect(calls[0]?.options?.apiKey).toBe("env-key");

      yield* Effect.promise(() => models.generateImages(model, context, { apiKey: "explicit" }));
      expect(calls[1]?.options?.apiKey).toBe("explicit");
    }),
  );

const mergesProviderResolvedEnvAndApplies = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: GenerateCall[] = [];
      const models = createModels();
      models.setProvider(
        createProvider({
          auth: {
            apiKey: {
              name: "Test key",
              resolve: () =>
                Promise.resolve({
                  auth: { apiKey: "provider-key", headers: { "x-base": "1" } },
                  env: { PROVIDER_ONLY: "provider", SHARED: "provider" },
                }),
            },
          },
          id: "p1",
          images: {
            "test-images": {
              generateImages: (model, _context, options) => {
                calls.push({ model, options });
                return Promise.resolve(okResult(model));
              },
            },
          },
          models: [imageModel("p1", "model-a")],
        }),
      );
      const model = models.getModelOfType("image", "p1", "model-a")!;

      yield* Effect.promise(() =>
        models.generateImages(model, context, {
          apiKey: "request-key",
          env: { REQUEST_ONLY: "request", SHARED: "request" },
          transformHeaders: (headers) => ({ ...headers, "x-extra": "2" }),
        }),
      );

      expect(calls[0]?.options?.apiKey).toBe("request-key");
      expect(calls[0]?.options?.env).toEqual({
        PROVIDER_ONLY: "provider",
        REQUEST_ONLY: "request",
        SHARED: "request",
      });
      expect(calls[0]?.options?.headers).toEqual({ "x-base": "1", "x-extra": "2" });
    }),
  );

describe("Models with image models", () => {
  it(
    "resolves auth through the provider and merges it into image requests; explicit options win",
    resolvesAuthThroughTheProviderAnd,
  );
});

describe("Models with image models", () => {
  it(
    "merges provider-resolved env and applies header transforms",
    mergesProviderResolvedEnvAndApplies,
  );
});
