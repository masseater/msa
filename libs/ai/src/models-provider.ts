import { Clock, Effect } from "effect";

import modelsCatalogQuery from "./models-catalog-query.ts";
import modelsKit from "./models-kit.ts";
import modelsShared from "./models-shared.ts";
import type modelsTypes from "./models.types.ts";
import type providerTypesModule from "./models/provider-types.ts";
import type typesModuleModule2 from "./types.types.ts";

const { attachClassifiers, attachImages } = modelsCatalogQuery;
const { hasKnownModelType } = modelsShared;
const { lazy, modelOperations, modelsError } = modelsKit;
const { getModelType, isModelType } = modelOperations;
const { ModelsError } = modelsError;
const { lazyStream } = lazy;

interface StreamImplementations {
  readonly single: typesModuleModule2.ProviderStreams | undefined;
  readonly byApi: Partial<Record<string, typesModuleModule2.ProviderStreams>> | undefined;
  readonly streams: readonly typesModuleModule2.ProviderStreams[];
}

const streamImplementations = <TApi extends typesModuleModule2.Api>(
  input: modelsTypes.CreateProviderOptions<TApi>,
): StreamImplementations => {
  const single =
    input.api !== undefined &&
    typeof (input.api as typesModuleModule2.ProviderStreams).stream === "function"
      ? (input.api as typesModuleModule2.ProviderStreams)
      : undefined;
  const byApi =
    single !== undefined || input.api === undefined
      ? undefined
      : (input.api as Partial<Record<string, typesModuleModule2.ProviderStreams>>);
  const streams =
    single === undefined
      ? Object.values(byApi ?? {}).filter((entry) => entry !== undefined)
      : [single];
  return { byApi, single, streams };
};

const assertHasImplementation = <TApi extends typesModuleModule2.Api>(
  input: modelsTypes.CreateProviderOptions<TApi>,
  streams: readonly typesModuleModule2.ProviderStreams[],
): void => {
  const hasImages = Object.values(input.images ?? {}).some((entry) => entry !== undefined);
  const hasClassifiers = Object.values(input.classifiers ?? {}).some(
    (entry) => entry !== undefined,
  );
  if (streams.length === 0 && !hasImages && !hasClassifiers) {
    throw new Error(
      `Provider ${input.id}: at least one of "api", "images", or "classifiers" is required.`,
    );
  }
};

interface DynamicModels<TApi extends typesModuleModule2.Api> {
  readonly set: (models: readonly providerTypesModule.ProviderModel<TApi>[]) => void;
  readonly current: () => readonly providerTypesModule.ProviderModel<TApi>[];
}

const dynamicModels = <TApi extends typesModuleModule2.Api>(
  baseline: readonly providerTypesModule.ProviderModel<TApi>[],
): DynamicModels<TApi> => {
  let dynamic: readonly providerTypesModule.ProviderModel<TApi>[] = [];
  return {
    current: () => {
      const merged = [...baseline];
      for (const model of dynamic) {
        const index = merged.findIndex(
          (entry) => getModelType(entry) === getModelType(model) && entry.id === model.id,
        );
        if (index >= 0) merged[index] = model;
        else merged.push(model);
      }
      return merged;
    },
    set: (models) => {
      dynamic = models;
    },
  };
};

interface ModelRefresher<TApi extends typesModuleModule2.Api> {
  readonly providerId: string;
  readonly models: DynamicModels<TApi>;
  readonly fetchModels: (
    context: providerTypesModule.RefreshModelsContext,
  ) => Promise<readonly providerTypesModule.ProviderModel<TApi>[]>;
}

const refreshFetchedModels =
  <TApi extends typesModuleModule2.Api>({
    providerId,
    models,
    fetchModels,
  }: ModelRefresher<TApi>) =>
  (context: providerTypesModule.RefreshModelsContext): Promise<void> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stored = context.stored;
        if (stored !== undefined) {
          const restored = stored.models
            .filter((model) => model.provider === providerId)
            .map((model) => model as providerTypesModule.ProviderModel<TApi>);
          const published = yield* Effect.promise(() =>
            context.publish({ update: () => models.set(restored) }),
          );
          if (!published) return;
        }
        if (!context.allowNetwork || context.signal.aborted) return;
        const fetched = yield* Effect.promise(() => fetchModels(context));
        if (context.signal.aborted) return;
        const refreshed = fetched.filter(hasKnownModelType);
        const checkedAt = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() =>
          context.publish({
            persist: { checkedAt, models: refreshed },
            update: () => models.set(refreshed),
          }),
        );
      }),
    );

const missingDeferred = (
  providerId: string,
  model: typesModuleModule2.Model<typesModuleModule2.Api>,
  action: string,
) =>
  ModelsError.create(
    "provider",
    `Provider ${providerId} ${action} deferred responses for "${model.api}"`,
  );

const attachDeferred = <TApi extends typesModuleModule2.Api>(
  provider: providerTypesModule.Provider<TApi>,
  implementations: StreamImplementations,
  apiFor: (
    model: typesModuleModule2.Model<typesModuleModule2.Api>,
  ) => typesModuleModule2.ProviderStreams | undefined,
): void => {
  if (implementations.streams.some((entry) => entry.fetchDeferred !== undefined)) {
    provider.fetchDeferred = (model, handle, options) =>
      lazyStream(model, () => {
        const implementation = apiFor(model);
        if (implementation?.fetchDeferred === undefined) {
          throw missingDeferred(provider.id, model, "does not support");
        }
        return implementation.fetchDeferred(model, handle, options);
      });
  }
  if (implementations.streams.some((entry) => entry.cancelDeferred !== undefined)) {
    provider.cancelDeferred = (model, handle, options) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const implementation = apiFor(model);
          const cancel = implementation?.cancelDeferred?.bind(implementation);
          if (cancel === undefined) {
            return yield* Effect.die(missingDeferred(provider.id, model, "cannot cancel"));
          }
          yield* Effect.promise(() => cancel(model, handle, options));
        }),
      );
  }
  if (implementations.streams.some((entry) => entry.countTokens !== undefined)) {
    provider.countTokens = (model, context, options) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const count = apiFor(model)?.countTokens;
          if (count === undefined) {
            return yield* Effect.die(
              ModelsError.create(
                "provider",
                `Provider ${provider.id} cannot count tokens for "${model.api}"`,
              ),
            );
          }
          return yield* Effect.promise(() => count(model, context, options));
        }),
      );
  }
};

const dispatcher =
  (
    providerId: string,
    apiFor: (
      model: typesModuleModule2.Model<typesModuleModule2.Api>,
    ) => typesModuleModule2.ProviderStreams | undefined,
  ) =>
  (
    model: typesModuleModule2.Model<typesModuleModule2.Api>,
    run: (
      streams: typesModuleModule2.ProviderStreams,
    ) => typesModuleModule2.AssistantMessageEventStream,
  ): typesModuleModule2.AssistantMessageEventStream => {
    const providerStreams = apiFor(model);
    if (providerStreams !== undefined) return run(providerStreams);
    return lazyStream(model, () => {
      throw ModelsError.create(
        "stream",
        `Provider ${providerId} has no API implementation for "${model.api}"`,
      );
    });
  };

const createProvider = <TApi extends typesModuleModule2.Api = typesModuleModule2.Api>(
  input: modelsTypes.CreateProviderOptions<TApi>,
): providerTypesModule.Provider<TApi> => {
  const implementations = streamImplementations(input);
  assertHasImplementation(input, implementations.streams);
  const models = dynamicModels(input.models);
  const apiFor = (
    model: typesModuleModule2.Model<typesModuleModule2.Api>,
  ): typesModuleModule2.ProviderStreams | undefined =>
    implementations.single ?? implementations.byApi?.[model.api];
  const dispatch = dispatcher(input.id, apiFor);

  const provider: providerTypesModule.Provider<TApi> = {
    auth: input.auth,
    baseUrl: input.baseUrl,
    getAllModels: () => models.current(),
    getModels: () =>
      models
        .current()
        .filter((model): model is typesModuleModule2.Model<TApi> => isModelType(model, "chat")),
    headers: input.headers,
    id: input.id,
    name: input.name ?? input.id,
    stream: (model, context, options) =>
      dispatch(model, (providerStreams) => providerStreams.stream(model, context, options)),
    streamSimple: (model, context, options) =>
      dispatch(model, (providerStreams) => providerStreams.streamSimple(model, context, options)),
    ...(input.filterModels === undefined ? {} : { filterModels: input.filterModels }),
    ...(input.filterAllModels === undefined ? {} : { filterAllModels: input.filterAllModels }),
  };

  if (input.fetchModels !== undefined) {
    provider.refreshModels = refreshFetchedModels({
      fetchModels: input.fetchModels,
      models,
      providerId: input.id,
    });
  }
  attachDeferred(provider, implementations, apiFor);
  attachImages({ input: input.images, provider });
  attachClassifiers({ input: input.classifiers, provider });
  return provider;
};

const modelsProvider = {
  assertHasImplementation,
  attachDeferred,
  createProvider,
  dispatcher,
  dynamicModels,
  missingDeferred,
  refreshFetchedModels,
  streamImplementations,
};

export default modelsProvider;
