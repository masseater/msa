import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createModels, createProvider } from "../src/models.ts";
import type {
  Api,
  DeferredCancelOptions,
  DeferredFetchOptions,
  DeferredHandle,
  Model,
} from "../src/types.ts";
import providersSupport from "./providers-support.ts";

const { context, recordingStreams, testModel } = providersSupport;

const resolvedAuth = {
  auth: {
    apiKey: "provider-key",
    baseUrl: "https://resolved.test/v1",
    headers: { Authorization: "Bearer provider", "X-Shared": "provider" },
  },
  env: { PROVIDER_ONLY: "provider", SHARED: "provider" },
};

const deferredProvider = () => {
  const seen: {
    cancelledOptions?: DeferredCancelOptions | undefined;
    fetchedModel?: Model<Api>;
    fetchedOptions?: DeferredFetchOptions | undefined;
  } = {};
  const model = { ...testModel("api-a", "model-a"), provider: "deferred-provider" };
  const streams = recordingStreams("deferred", []);
  streams.fetchDeferred = (fetchedModel, _handle, options) => {
    seen.fetchedModel = fetchedModel;
    seen.fetchedOptions = options;
    return streams.streamSimple(fetchedModel, context);
  };
  streams.cancelDeferred = (_model, _handle, options) => {
    seen.cancelledOptions = options;
    return Promise.resolve();
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      api: streams,
      auth: { apiKey: { name: "Test", resolve: () => Promise.resolve(resolvedAuth) } },
      id: "deferred-provider",
      models: [model],
    }),
  );
  const handle: DeferredHandle = {
    api: model.api,
    id: "response-1",
    modelId: model.id,
    provider: model.provider,
  };
  return { handle, model, models, seen };
};

const appliesResolvedOptionsToDeferred = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { handle, model, models, seen } = deferredProvider();
      yield* Effect.promise(() =>
        models.fetchDeferred(model, handle, {
          apiKey: "request-key",
          env: { REQUEST_ONLY: "request", SHARED: "request" },
          headers: { "X-Request": "request", "x-shared": "request" },
          timeoutMs: 100,
          transformHeaders: (headers) => ({ ...headers, "X-Transformed": "yes" }),
          wait: 50,
        }),
      );
      yield* Effect.promise(() =>
        models.cancelDeferred(model, handle, {
          timeoutMs: 200,
          transformHeaders: (headers) => ({ ...headers, "X-Cancel": "yes" }),
        }),
      );

      expect(seen.fetchedModel?.baseUrl).toBe("https://resolved.test/v1");
      expect(seen.fetchedOptions).toMatchObject({
        apiKey: "request-key",
        env: { PROVIDER_ONLY: "provider", REQUEST_ONLY: "request", SHARED: "request" },
        headers: {
          Authorization: "Bearer provider",
          "X-Request": "request",
          "X-Transformed": "yes",
          "x-shared": "request",
        },
        timeoutMs: 100,
        wait: 50,
      });
      expect(seen.cancelledOptions).toMatchObject({
        apiKey: "provider-key",
        env: { PROVIDER_ONLY: "provider", SHARED: "provider" },
        headers: { Authorization: "Bearer provider", "X-Cancel": "yes", "X-Shared": "provider" },
        timeoutMs: 200,
      });
    }),
  );

describe("createProvider", () => {
  it(
    "applies resolved request options to deferred fetch and cancellation",
    appliesResolvedOptionsToDeferred,
  );
});
