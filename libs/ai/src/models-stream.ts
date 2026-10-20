import { Effect } from "effect";

import modelsAuthApply from "./models-auth-apply.ts";
import modelsKit from "./models-kit.ts";
import type modelsStateTypes from "./models-state.types.ts";
import type typesModuleModule from "./models/types.ts";
import type typesModuleModule2 from "./types.types.ts";
import transcriptModule from "./utils/transcript.ts";

const { applyAuth, requireChatProvider, requireProvider } = modelsAuthApply;
const { lazy, modelOperations, modelsError } = modelsKit;
const { assertClassifierInputSupported, classifierErrorResult, imageErrorResult } = modelOperations;
const { ModelsError } = modelsError;
const { lazyStream } = lazy;
const { normalizeContext } = transcriptModule;

const assertClassifierModel: typeof modelOperations.assertClassifierModel =
  modelOperations.assertClassifierModel;

const assertImageModel: typeof modelOperations.assertImageModel = modelOperations.assertImageModel;

interface StreamRequest<TApi extends typesModuleModule2.Api, TOptions> {
  readonly state: modelsStateTypes.ModelsState;
  readonly model: typesModuleModule2.Model<TApi>;
  readonly context: typesModuleModule2.Context;
  readonly options: TOptions | undefined;
}

const streamModel = <TApi extends typesModuleModule2.Api>({
  state,
  model,
  context,
  options,
}: StreamRequest<
  TApi,
  typesModuleModule.ModelsApiStreamOptions<TApi>
>): typesModuleModule2.AssistantMessageEventStream => {
  const transcript = normalizeContext(context);
  return lazyStream(model, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = requireChatProvider({ model, state });
        const { requestModel, requestOptions } = yield* applyAuth({
          model,
          options: options as
            | typesModuleModule.ModelsApiStreamOptions<typesModuleModule2.Api>
            | undefined,
          state,
        });
        return provider.stream(
          requestModel,
          transcript,
          requestOptions as typesModuleModule2.ApiStreamOptions<TApi>,
        );
      }),
    ),
  );
};

const streamModelSimple = ({
  state,
  model,
  context,
  options,
}: StreamRequest<
  typesModuleModule2.Api,
  typesModuleModule.ModelsSimpleStreamOptions
>): typesModuleModule2.AssistantMessageEventStream => {
  const transcript = normalizeContext(context);
  return lazyStream(model, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = requireChatProvider({ model, state });
        const { requestModel, requestOptions } = yield* applyAuth({ model, options, state });
        return provider.streamSimple(
          requestModel,
          transcript,
          requestOptions as typesModuleModule2.SimpleStreamOptions,
        );
      }),
    ),
  );
};

interface DeferredRequest<TOptions> {
  readonly state: modelsStateTypes.ModelsState;
  readonly model: typesModuleModule2.Model<typesModuleModule2.Api>;
  readonly handle: typesModuleModule2.DeferredHandle;
  readonly options: TOptions | undefined;
}

const unsupportedDeferred = (model: typesModuleModule2.Model<typesModuleModule2.Api>) =>
  new ModelsError("provider", `Provider ${model.provider} does not support deferred responses`);

const streamDeferred = ({
  state,
  model,
  handle,
  options,
}: DeferredRequest<typesModuleModule.ModelsDeferredFetchOptions>): typesModuleModule2.AssistantMessageEventStream =>
  lazyStream(model, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = requireChatProvider({ model, state });
        const fetchDeferred = provider.fetchDeferred?.bind(provider);
        if (fetchDeferred === undefined) return yield* Effect.die(unsupportedDeferred(model));
        const { requestModel, requestOptions } = yield* applyAuth({ model, options, state });
        return fetchDeferred(
          requestModel,
          handle,
          requestOptions as typesModuleModule2.DeferredFetchOptions,
        );
      }),
    ),
  );

const cancelDeferred = ({
  state,
  model,
  handle,
  options,
}: DeferredRequest<typesModuleModule.ModelsDeferredCancelOptions>): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const provider = requireChatProvider({ model, state });
      const cancel = provider.cancelDeferred?.bind(provider);
      if (cancel === undefined) return yield* Effect.die(unsupportedDeferred(model));
      const { requestModel, requestOptions } = yield* applyAuth({ model, options, state });
      yield* Effect.promise(() => cancel(requestModel, handle, requestOptions));
    }),
  );

const countModelTokens = ({
  state,
  model,
  context,
  options,
}: StreamRequest<typesModuleModule2.Api, typesModuleModule.ModelsSimpleStreamOptions>): Promise<
  number | undefined
> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const provider = requireChatProvider({ model, state });
      const count = provider.countTokens?.bind(provider);
      if (count === undefined) return undefined;
      const { requestModel, requestOptions } = yield* applyAuth({ model, options, state });
      return yield* Effect.promise(() =>
        count(
          requestModel,
          normalizeContext(context),
          requestOptions as typesModuleModule2.SimpleStreamOptions,
        ),
      );
    }),
  );

interface ImagesRequest {
  readonly state: modelsStateTypes.ModelsState;
  readonly model: typesModuleModule2.ImageModel<typesModuleModule2.ImageApi>;
  readonly context: typesModuleModule2.ImagesContext;
  readonly options: typesModuleModule.ModelsImagesOptions | undefined;
}

const generateImages = ({
  state,
  model,
  context,
  options,
}: ImagesRequest): Promise<typesModuleModule2.AssistantImages> =>
  Effect.runPromise(
    Effect.gen(function* () {
      assertImageModel(model);
      const provider = requireProvider({ model, state });
      const generate = provider.generateImages?.bind(provider);
      if (generate === undefined) {
        return yield* Effect.die(
          new ModelsError(
            "provider",
            `Provider ${model.provider} does not support image generation`,
          ),
        );
      }
      const { requestModel, requestOptions } = yield* applyAuth({ model, options, state });
      return yield* Effect.promise(() => generate(requestModel, context, requestOptions));
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => imageErrorResult(model, error, options?.signal?.aborted)),
      ),
    ),
  );

interface ClassifyRequest {
  readonly state: modelsStateTypes.ModelsState;
  readonly model: typesModuleModule2.ClassifierModel<typesModuleModule2.ClassifierApi>;
  readonly context: typesModuleModule2.ClassifierContext;
  readonly options: typesModuleModule.ModelsClassifierOptions | undefined;
}

const classify = ({
  state,
  model,
  context,
  options,
}: ClassifyRequest): Promise<typesModuleModule2.ClassifierResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      assertClassifierModel(model);
      assertClassifierInputSupported(model, context);
      const provider = requireProvider({ model, state });
      const run = provider.classify?.bind(provider);
      if (run === undefined) {
        return yield* Effect.die(
          new ModelsError("provider", `Provider ${model.provider} does not support classification`),
        );
      }
      const { requestModel, requestOptions } = yield* applyAuth({ model, options, state });
      return yield* Effect.promise(() => run(requestModel, context, requestOptions));
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => classifierErrorResult(model, error, options?.signal?.aborted)),
      ),
    ),
  );

const modelsStream = {
  assertClassifierModel,
  assertImageModel,
  cancelDeferred,
  classify,
  countModelTokens,
  generateImages,
  streamDeferred,
  streamModel,
  streamModelSimple,
  unsupportedDeferred,
};

export default modelsStream;
