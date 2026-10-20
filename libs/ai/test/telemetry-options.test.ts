import { NOOP_TELEMETRY_CONTEXT, type TelemetryContext } from "@msa/telemetry";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { buildBaseOptions } from "../src/api/simple-options.ts";
import { registerImagesApiProvider } from "../src/images-api-registry.ts";
import { generateImages } from "../src/images.ts";
import { createModels, createProvider } from "../src/models.ts";
import type { MutableModels, Provider } from "../src/models.ts";
import type {
  DeferredHandle,
  ImageModel,
  ImagesContext,
  Model,
  ProviderRequestOptions,
} from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const telemetryContext: TelemetryContext = NOOP_TELEMETRY_CONTEXT;
const context = normalizeContext({ messages: [] });
const imagesContext: ImagesContext = { input: [{ text: "circle", type: "text" }] };

const model: Model<"telemetry-test"> = {
  api: "telemetry-test",
  baseUrl: "https://example.test",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "model",
  input: ["text"],
  maxTokens: 100,
  name: "Model",
  provider: "telemetry-provider",
  reasoning: false,
};

const imageModel: ImageModel<"telemetry-test-images"> = {
  api: "telemetry-test-images",
  baseUrl: "https://example.test",
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "image-model",
  input: ["text"],
  name: "Image Model",
  output: ["image"],
  provider: "telemetry-image-provider",
  type: "image",
};

function completedStream(requestModel: Model<string>): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({
      message: {
        api: requestModel.api,
        content: [],
        model: requestModel.id,
        provider: requestModel.provider,
        role: "assistant",
        stopReason: "stop",
        timestamp: 0,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
      reason: "stop",
      type: "done",
    });
  });
  return stream;
}

const isInheritedByEveryRequestOption = () => {
  const options = { telemetryContext } satisfies ProviderRequestOptions;
  expect(options.telemetryContext).toBe(telemetryContext);
  expect(buildBaseOptions(model, context, { telemetryContext }).telemetryContext).toBe(
    telemetryContext,
  );
};

describe("ProviderRequestOptions.telemetryContext", () => {
  it(
    "is inherited by every request option surface and simple-stream conversion",
    isInheritedByEveryRequestOption,
  );
});

const survivesProviderAndModelsStreamDeferred = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const {
        models,
        provider,
        handle,
        observed,
      }: {
        models: MutableModels;
        provider: Provider<"telemetry-test">;
        handle: DeferredHandle;
        observed: (TelemetryContext | undefined)[];
      } = yield* survivesProviderAndModelsStreamDeferredStep1();
      models.setProvider(provider);
      yield* Effect.promise(() => models.stream(model, context, { telemetryContext }).result());
      yield* Effect.promise(() =>
        models.streamSimple(model, context, { telemetryContext }).result(),
      );
      yield* Effect.promise(() => models.fetchDeferred(model, handle, { telemetryContext }));
      yield* Effect.promise(() => models.cancelDeferred(model, handle, { telemetryContext }));

      expect(observed).toHaveLength(8);
      expect(observed.every((value) => value === telemetryContext)).toBe(true);
    }),
  );

describe("ProviderRequestOptions.telemetryContext", () => {
  it(
    "survives provider and Models stream/deferred dispatch",
    survivesProviderAndModelsStreamDeferred,
  );
});

const survivesDirectAndModelsImageDispatch = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const observed: Array<TelemetryContext | undefined> = [];
      registerImagesApiProvider({
        api: imageModel.api,
        generateImages: (requestModel, _context, options) => {
          observed.push(options?.telemetryContext);
          return Promise.resolve({
            api: requestModel.api,
            model: requestModel.id,
            output: [],
            provider: requestModel.provider,
            stopReason: "stop",
            timestamp: 0,
          });
        },
      });
      yield* Effect.promise(() => generateImages(imageModel, imagesContext, { telemetryContext }));

      const models = createModels();
      models.setProvider(
        createProvider({
          auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
          id: imageModel.provider,
          images: {
            [imageModel.api]: {
              generateImages: (requestModel, _context, options) => {
                observed.push(options?.telemetryContext);
                return Promise.resolve({
                  api: requestModel.api,
                  model: requestModel.id,
                  output: [],
                  provider: requestModel.provider,
                  stopReason: "stop",
                  timestamp: 0,
                });
              },
            },
          },
          models: [imageModel],
        }),
      );
      yield* Effect.promise(() =>
        models.generateImages(imageModel, imagesContext, { telemetryContext }),
      );

      expect(observed).toEqual([telemetryContext, telemetryContext]);
    }),
  );

describe("ProviderRequestOptions.telemetryContext", () => {
  it("survives direct and Models image dispatch", survivesDirectAndModelsImageDispatch);
});

const survivesProviderAndModelsStreamDeferredStep1 = () =>
  Effect.gen(function* () {
    const observed: Array<TelemetryContext | undefined> = [];
    const handle: DeferredHandle = {
      api: model.api,
      id: "response",
      modelId: model.id,
      provider: model.provider,
    };
    const provider = createProvider({
      api: {
        cancelDeferred: (_requestModel, _handle, options) => {
          observed.push(options?.telemetryContext);

          return Promise.resolve();
        },
        fetchDeferred: (requestModel, _handle, options) => {
          observed.push(options?.telemetryContext);
          return completedStream(requestModel);
        },
        stream: (requestModel, _context, options) => {
          observed.push(options?.telemetryContext);
          return completedStream(requestModel);
        },
        streamSimple: (requestModel, _context, options) => {
          observed.push(options?.telemetryContext);
          return completedStream(requestModel);
        },
      },
      auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
      id: model.provider,
      models: [model],
    });

    yield* Effect.promise(() => provider.stream(model, context, { telemetryContext }).result());
    yield* Effect.promise(() =>
      provider.streamSimple(model, context, { telemetryContext }).result(),
    );
    yield* Effect.promise(() =>
      provider.fetchDeferred!(model, handle, { telemetryContext }).result(),
    );
    yield* Effect.promise(() => provider.cancelDeferred!(model, handle, { telemetryContext }));

    const models = createModels();
    return { handle, models, observed, provider };
  });
