import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { ApiKeyAuth } from "../src/auth/types.ts";
import { createModels } from "../src/models.ts";
import type { Api, Model, StreamOptions } from "../src/types.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { context, envKeyAuth, testModel, testProvider } = modelsRuntimeSupport;

interface ProviderCall {
  model: Model<Api>;
  options: StreamOptions | undefined;
}

const mergesResolvedAuthIntoStreamOptions = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: ProviderCall[] = [];
      const apiKey: ApiKeyAuth = {
        name: "Test",
        resolve: () =>
          Promise.resolve({
            auth: {
              apiKey: "resolved-key",
              baseUrl: "https://auth.test/v1",
              headers: { Authorization: "Bearer resolved-key", "x-a": "auth", "x-b": "auth" },
            },
          }),
      };
      const models = createModels();
      models.setProvider(testProvider({ auth: { apiKey }, calls, id: "p1" }));
      const model = testModel("p1", "model-a");

      const result = yield* Effect.promise(() =>
        models.completeSimple(model, context, {
          apiKey: "explicit-key",
          headers: { authorization: "Explicit token", "x-b": "explicit" },
        }),
      );
      expect(result.stopReason).toBe("stop");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.options?.apiKey).toBe("explicit-key");
      expect(calls[0]?.options?.headers).toEqual({
        authorization: "Explicit token",
        "x-a": "auth",
        "x-b": "explicit",
      });
      expect(calls[0]?.model.baseUrl).toBe("https://auth.test/v1");

      const result2 = yield* Effect.promise(() => models.completeSimple(model, context));
      expect(result2.stopReason).toBe("stop");
      expect(calls[1]?.options?.apiKey).toBe("resolved-key");
    }),
  );

const addsModelHeadersOnlyForModel = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: ProviderCall[] = [];
      const models = createModels();
      models.setProvider(testProvider({ auth: { apiKey: envKeyAuth("key") }, calls, id: "p1" }));
      const model = testModel("p1", "model-a");
      model.headers = { "x-model": "model", "x-shared": "model" };

      expect((yield* Effect.promise(() => models.getAuth("p1")))?.auth.headers).toBeUndefined();
      expect((yield* Effect.promise(() => models.getAuth(model)))?.auth.headers).toEqual({
        "x-model": "model",
        "x-shared": "model",
      });

      const transforms = { value: 0 };
      yield* Effect.promise(() =>
        models.completeSimple(model, context, {
          headers: { "X-Shared": "explicit", "x-explicit": "explicit" },
          transformHeaders: (headers) => {
            transforms.value++;
            expect(headers).toEqual({
              "X-Shared": "explicit",
              "x-explicit": "explicit",
              "x-model": "model",
            });
            return Promise.resolve({ ...headers, "x-transformed": "yes" });
          },
        }),
      );

      expect(transforms.value).toBe(1);
      expect(calls[0]?.options?.headers).toEqual({
        "X-Shared": "explicit",
        "x-explicit": "explicit",
        "x-model": "model",
        "x-transformed": "yes",
      });
      expect(calls[0]?.options).not.toHaveProperty("transformHeaders");
    }),
  );

describe("Models runtime", () => {
  it(
    "merges resolved auth into stream options; explicit options win per field",
    mergesResolvedAuthIntoStreamOptions,
  );
});

describe("Models runtime", () => {
  it(
    "adds model headers only for model auth and transforms assembled headers once",
    addsModelHeadersOnlyForModel,
  );
});
