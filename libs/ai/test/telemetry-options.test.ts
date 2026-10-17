import { NOOP_TELEMETRY_CONTEXT, type TelemetryContext } from "@msa/telemetry";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { buildBaseOptions } from "../src/api/simple-options.ts";
import { registerImagesApiProvider } from "../src/images-api-registry.ts";
import { generateImages } from "../src/images.ts";
import { createModels, createProvider } from "../src/models.ts";
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
const imagesContext: ImagesContext = { input: [{ type: "text", text: "circle" }] };

const model: Model<"telemetry-test"> = {
  id: "model",
  name: "Model",
  api: "telemetry-test",
  provider: "telemetry-provider",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

const imageModel: ImageModel<"telemetry-test-images"> = {
  type: "image",
  id: "image-model",
  name: "Image Model",
  api: "telemetry-test-images",
  provider: "telemetry-image-provider",
  baseUrl: "https://example.test",
  input: ["text"],
  output: ["image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function completedStream(requestModel: Model<string>): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({
      type: "done",
      reason: "stop",
      message: {
        role: "assistant",
        content: [],
        api: requestModel.api,
        provider: requestModel.provider,
        model: requestModel.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 0,
      },
    });
  });
  return stream;
}

describe("ProviderRequestOptions.telemetryContext", () => {
  it("is inherited by every request option surface and simple-stream conversion", () => {
    const options = { telemetryContext } satisfies ProviderRequestOptions;
    expect(options.telemetryContext).toBe(telemetryContext);
    expect(buildBaseOptions(model, context, { telemetryContext }).telemetryContext).toBe(
      telemetryContext,
    );
  });

  it("survives provider and Models stream/deferred dispatch", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const observed: Array<TelemetryContext | undefined> = [];
        const handle: DeferredHandle = {
          provider: model.provider,
          modelId: model.id,
          api: model.api,
          id: "response",
        };
        const provider = createProvider({
          id: model.provider,
          auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
          models: [model],
          api: {
            stream: (requestModel, _context, options) => {
              observed.push(options?.telemetryContext);
              return completedStream(requestModel);
            },
            streamSimple: (requestModel, _context, options) => {
              observed.push(options?.telemetryContext);
              return completedStream(requestModel);
            },
            fetchDeferred: (requestModel, _handle, options) => {
              observed.push(options?.telemetryContext);
              return completedStream(requestModel);
            },
            cancelDeferred: (_requestModel, _handle, options) => {
              observed.push(options?.telemetryContext);

              return Promise.resolve();
            },
          },
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
    ));

  it("survives direct and Models image dispatch", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const observed: Array<TelemetryContext | undefined> = [];
        registerImagesApiProvider({
          api: imageModel.api,
          generateImages: (requestModel, _context, options) => {
            observed.push(options?.telemetryContext);
            return Promise.resolve({
              api: requestModel.api,
              provider: requestModel.provider,
              model: requestModel.id,
              output: [],
              stopReason: "stop",
              timestamp: 0,
            });
          },
        });
        yield* Effect.promise(() =>
          generateImages(imageModel, imagesContext, { telemetryContext }),
        );

        const models = createModels();
        models.setProvider(
          createProvider({
            id: imageModel.provider,
            auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
            models: [imageModel],
            images: {
              [imageModel.api]: {
                generateImages: (requestModel, _context, options) => {
                  observed.push(options?.telemetryContext);
                  return Promise.resolve({
                    api: requestModel.api,
                    provider: requestModel.provider,
                    model: requestModel.id,
                    output: [],
                    stopReason: "stop",
                    timestamp: 0,
                  });
                },
              },
            },
          }),
        );
        yield* Effect.promise(() =>
          models.generateImages(imageModel, imagesContext, { telemetryContext }),
        );

        expect(observed).toEqual([telemetryContext, telemetryContext]);
      }),
    ));
});
