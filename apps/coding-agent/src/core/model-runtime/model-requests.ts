import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import modelOperations from "@msa/ai/utils/model-operations";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type modelRuntimeTypes from "../model-runtime.types.ts";
import virtualModelsModule from "../virtual-models.ts";
import requestPreparation from "./request-preparation.ts";

const { isVirtualModel } = virtualModelsModule;
const { prepareRequest } = requestPreparation;
const { awaited, awaitingWith } = awaitingModule;
const { ModelsError, lazyStream, normalizeContext } = ai;
const { assertClassifierInputSupported, classifierErrorResult, imageErrorResult } = modelOperations;

const assertChatModel: typeof modelOperations.assertChatModel = modelOperations.assertChatModel;
const assertClassifierModel: typeof modelOperations.assertClassifierModel =
  modelOperations.assertClassifierModel;
const assertImageModel: typeof modelOperations.assertImageModel = modelOperations.assertImageModel;

type ChatModel = aiTypes.Model<aiTypes.Api>;

interface RequestHost {
  readonly models: aiTypes.MutableModels;
  getAuth(
    model: aiTypes.AnyModel,
    overrides: modelRuntimeTypes.ModelRuntimeAuthOverrides,
  ): Promise<aiTypes.AuthResult | undefined>;
  resolveModel(
    model: ChatModel,
    messages: readonly aiTypes.Message[],
    options: modelRuntimeTypes.ModelRouteOptions,
  ): Promise<modelRuntimeTypes.ModelRoute>;
  streamSimple(
    model: ChatModel,
    context: aiTypes.Context,
    options?: aiTypes.ModelsSimpleStreamOptions,
  ): aiTypes.AssistantMessageEventStream;
}

function supported<F>(capability: F | undefined, model: aiTypes.AnyModel, feature: string): F {
  if (capability === undefined) {
    throw new ModelsError("provider", `Provider ${model.provider} does not support ${feature}`);
  }
  return capability;
}

export default class ModelRequests {
  private readonly host: RequestHost;

  constructor(host: RequestHost) {
    this.host = host;
  }

  stream<TApi extends aiTypes.Api>(
    model: aiTypes.Model<TApi>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsApiStreamOptions<TApi>,
  ): aiTypes.AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    return lazyStream(model, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          assertChatModel(model);
          const prepared = yield* awaited(
            prepareRequest(
              this.host,
              model,
              options as (aiTypes.StreamOptions & aiTypes.ModelsRequestTransforms) | undefined,
            ),
          );
          return prepared.provider.stream(
            prepared.model,
            transcript,
            prepared.options as aiTypes.ApiStreamOptions<TApi>,
          );
        }, this),
      ),
    );
  }

  streamSimple(
    model: ChatModel,
    context: aiTypes.Context,
    options?: aiTypes.ModelsSimpleStreamOptions,
  ): aiTypes.AssistantMessageEventStream {
    if (isVirtualModel(model)) return this.streamRouted(model, context, options);
    const transcript = normalizeContext(context);
    return lazyStream(model, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          assertChatModel(model);
          const prepared = yield* awaited(prepareRequest(this.host, model, options));
          return prepared.provider.streamSimple(
            prepared.model,
            transcript,
            prepared.options as aiTypes.SimpleStreamOptions,
          );
        }, this),
      ),
    );
  }

  streamDeferred(
    model: ChatModel,
    handle: aiTypes.DeferredHandle,
    options?: aiTypes.ModelsDeferredFetchOptions,
  ): aiTypes.AssistantMessageEventStream {
    return lazyStream(model, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          assertChatModel(model);
          const prepared = yield* awaited(prepareRequest(this.host, model, options));
          return supported(prepared.provider.fetchDeferred, model, "deferred responses").call(
            prepared.provider,
            prepared.model,
            handle,
            prepared.options as aiTypes.DeferredFetchOptions,
          );
        }, this),
      ),
    );
  }

  cancelDeferred(
    model: ChatModel,
    handle: aiTypes.DeferredHandle,
    options?: aiTypes.ModelsDeferredCancelOptions,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        assertChatModel(model);
        const prepared = yield* awaited(prepareRequest(this.host, model, options));
        yield* awaited(
          supported(prepared.provider.cancelDeferred, model, "deferred responses").call(
            prepared.provider,
            prepared.model,
            handle,
            prepared.options as aiTypes.DeferredCancelOptions,
          ),
        );
      }, this),
    );
  }

  countTokens(
    model: ChatModel,
    context: aiTypes.Context,
    options?: aiTypes.ModelsSimpleStreamOptions,
  ): Promise<number | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (isVirtualModel(model)) return undefined;
        assertChatModel(model);
        const prepared = yield* awaited(prepareRequest(this.host, model, options));
        if (prepared.provider.countTokens === undefined) return undefined;
        return yield* awaited(
          prepared.provider.countTokens(
            prepared.model,
            normalizeContext(context),
            prepared.options as aiTypes.SimpleStreamOptions,
          ),
        );
      }, this),
    );
  }

  generateImages(
    model: aiTypes.ImageModel<aiTypes.ImageApi>,
    context: aiTypes.ImagesContext,
    options?: aiTypes.ModelsImagesOptions,
  ): Promise<aiTypes.AssistantImages> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          assertImageModel(model);
          const prepared = yield* awaited(prepareRequest(this.host, model, options));
          return yield* awaited(
            supported(prepared.provider.generateImages, model, "image generation").call(
              prepared.provider,
              prepared.model,
              context,
              prepared.options as aiTypes.ImagesOptions,
            ),
          );
        } catch (error) {
          return imageErrorResult(model, error, options?.signal?.aborted);
        }
      }, this),
    );
  }

  classify(
    model: aiTypes.ClassifierModel<aiTypes.ClassifierApi>,
    context: aiTypes.ClassifierContext,
    options?: aiTypes.ModelsClassifierOptions,
  ): Promise<aiTypes.ClassifierResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          assertClassifierModel(model);
          assertClassifierInputSupported(model, context);
          const prepared = yield* awaited(prepareRequest(this.host, model, options));
          return yield* awaited(
            supported(prepared.provider.classify, model, "classification").call(
              prepared.provider,
              prepared.model,
              context,
              prepared.options as aiTypes.ClassifierOptions,
            ),
          );
        } catch (error) {
          return classifierErrorResult(model, error, options?.signal?.aborted);
        }
      }, this),
    );
  }

  private streamRouted(
    model: ChatModel,
    context: aiTypes.Context,
    options: aiTypes.ModelsSimpleStreamOptions | undefined,
  ): aiTypes.AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    return lazyStream(model, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          const route = yield* awaited(
            this.host.resolveModel(model, transcript.messages, {
              reason: "direct",
              signal: options?.signal,
              thinkingLevel: options?.reasoning ?? "off",
            }),
          );
          const { maxTokens: limit } = route.model;
          const maxTokens =
            options?.maxTokens !== undefined && options?.maxTokens !== 0 && limit > 0
              ? Math.min(options.maxTokens, limit)
              : options?.maxTokens;
          const reasoning = route.thinkingLevel === "off" ? undefined : route.thinkingLevel;
          const { apiKey, headers, env, ...rest } = options ?? {};
          const auth = route.model.provider === model.provider ? { apiKey, env, headers } : {};
          return this.host.streamSimple(route.model, context, {
            ...rest,
            ...auth,
            maxTokens,
            reasoning,
          });
        }, this),
      ),
    );
  }
}
