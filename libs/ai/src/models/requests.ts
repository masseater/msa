import { Effect } from "effect";

import { lazyStream } from "../api/lazy.ts";
import type {
  Api,
  ApiStreamOptions,
  AssistantImages,
  AssistantMessageEventStream,
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierResult,
  Context,
  DeferredFetchOptions,
  DeferredHandle,
  ImageApi,
  ImageModel,
  ImagesContext,
  Model,
  SimpleStreamOptions,
} from "../types.ts";
import {
  assertClassifierInputSupported,
  assertClassifierModel,
  assertImageModel,
  classifierErrorResult,
  imageErrorResult,
} from "../utils/model-operations.ts";
import { ModelsError } from "../utils/models-error.ts";
import { normalizeContext } from "../utils/transcript.ts";
import { applyAuth, requireChatProvider, requireProvider } from "./apply-auth.ts";
import type { ModelsState } from "./state.ts";
import type {
  ModelsApiStreamOptions,
  ModelsClassifierOptions,
  ModelsDeferredCancelOptions,
  ModelsDeferredFetchOptions,
  ModelsImagesOptions,
  ModelsSimpleStreamOptions,
} from "./types.ts";

export interface StreamRequest<TApi extends Api, TOptions> {
  readonly state: ModelsState;
  readonly model: Model<TApi>;
  readonly context: Context;
  readonly options: TOptions | undefined;
}

export const streamModel = <TApi extends Api>({
  state,
  model,
  context,
  options,
}: StreamRequest<TApi, ModelsApiStreamOptions<TApi>>): AssistantMessageEventStream => {
  const transcript = normalizeContext(context);
  return lazyStream(model, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = requireChatProvider({ state, model });
        const { requestModel, requestOptions } = yield* applyAuth({
          state,
          model,
          options: options as ModelsApiStreamOptions<Api> | undefined,
        });
        return provider.stream(requestModel, transcript, requestOptions as ApiStreamOptions<TApi>);
      }),
    ),
  );
};

export const streamModelSimple = ({
  state,
  model,
  context,
  options,
}: StreamRequest<Api, ModelsSimpleStreamOptions>): AssistantMessageEventStream => {
  const transcript = normalizeContext(context);
  return lazyStream(model, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = requireChatProvider({ state, model });
        const { requestModel, requestOptions } = yield* applyAuth({ state, model, options });
        return provider.streamSimple(
          requestModel,
          transcript,
          requestOptions as SimpleStreamOptions,
        );
      }),
    ),
  );
};

export interface DeferredRequest<TOptions> {
  readonly state: ModelsState;
  readonly model: Model<Api>;
  readonly handle: DeferredHandle;
  readonly options: TOptions | undefined;
}

const unsupportedDeferred = (model: Model<Api>) =>
  new ModelsError("provider", `Provider ${model.provider} does not support deferred responses`);

export const streamDeferred = ({
  state,
  model,
  handle,
  options,
}: DeferredRequest<ModelsDeferredFetchOptions>): AssistantMessageEventStream =>
  lazyStream(model, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = requireChatProvider({ state, model });
        const fetchDeferred = provider.fetchDeferred?.bind(provider);
        if (fetchDeferred === undefined) return yield* Effect.die(unsupportedDeferred(model));
        const { requestModel, requestOptions } = yield* applyAuth({ state, model, options });
        return fetchDeferred(requestModel, handle, requestOptions as DeferredFetchOptions);
      }),
    ),
  );

export const cancelDeferred = ({
  state,
  model,
  handle,
  options,
}: DeferredRequest<ModelsDeferredCancelOptions>): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const provider = requireChatProvider({ state, model });
      const cancel = provider.cancelDeferred?.bind(provider);
      if (cancel === undefined) return yield* Effect.die(unsupportedDeferred(model));
      const { requestModel, requestOptions } = yield* applyAuth({ state, model, options });
      yield* Effect.promise(() => cancel(requestModel, handle, requestOptions));
    }),
  );

export interface ImagesRequest {
  readonly state: ModelsState;
  readonly model: ImageModel<ImageApi>;
  readonly context: ImagesContext;
  readonly options: ModelsImagesOptions | undefined;
}

export const generateImages = ({
  state,
  model,
  context,
  options,
}: ImagesRequest): Promise<AssistantImages> =>
  Effect.runPromise(
    Effect.gen(function* () {
      assertImageModel(model);
      const provider = requireProvider({ state, model });
      const generate = provider.generateImages?.bind(provider);
      if (generate === undefined) {
        return yield* Effect.die(
          new ModelsError(
            "provider",
            `Provider ${model.provider} does not support image generation`,
          ),
        );
      }
      const { requestModel, requestOptions } = yield* applyAuth({ state, model, options });
      return yield* Effect.promise(() => generate(requestModel, context, requestOptions));
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => imageErrorResult(model, error, options?.signal?.aborted)),
      ),
    ),
  );

export interface ClassifyRequest {
  readonly state: ModelsState;
  readonly model: ClassifierModel<ClassifierApi>;
  readonly context: ClassifierContext;
  readonly options: ModelsClassifierOptions | undefined;
}

export const classify = ({
  state,
  model,
  context,
  options,
}: ClassifyRequest): Promise<ClassifierResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      assertClassifierModel(model);
      assertClassifierInputSupported(model, context);
      const provider = requireProvider({ state, model });
      const run = provider.classify?.bind(provider);
      if (run === undefined) {
        return yield* Effect.die(
          new ModelsError("provider", `Provider ${model.provider} does not support classification`),
        );
      }
      const { requestModel, requestOptions } = yield* applyAuth({ state, model, options });
      return yield* Effect.promise(() => run(requestModel, context, requestOptions));
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => classifierErrorResult(model, error, options?.signal?.aborted)),
      ),
    ),
  );
