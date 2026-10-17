import { Clock, Effect } from "effect";

import { lazyStream } from "../api/lazy.ts";
import type { Credential, ProviderAuth } from "../auth/types.ts";
import type {
  Api,
  AssistantMessageEventStream,
  ClassifierApi,
  ImageApi,
  Model,
  ProviderClassifier,
  ProviderHeaders,
  ProviderImages,
  ProviderStreams,
} from "../types.ts";
import { getModelType, isModelType } from "../utils/model-operations.ts";
import { ModelsError } from "../utils/models-error.ts";
import { attachClassifiers, attachImages } from "./provider-capabilities.ts";
import type { Provider, ProviderModel, RefreshModelsContext } from "./provider-types.ts";
import { hasKnownModelType } from "./state.ts";

export interface CreateProviderOptions<TApi extends Api = Api> {
  id: string;
  name?: string | undefined;
  baseUrl?: string | undefined;
  headers?: ProviderHeaders | undefined;
  auth: ProviderAuth;
  models: readonly ProviderModel<TApi>[];
  fetchModels?:
    | ((context: RefreshModelsContext) => Promise<readonly ProviderModel<TApi>[]>)
    | undefined;
  filterModels?: (
    models: readonly Model<TApi>[],
    credential: Credential | undefined,
  ) => readonly Model<TApi>[];
  filterAllModels?: (
    models: readonly ProviderModel<TApi>[],
    credential: Credential | undefined,
  ) => readonly ProviderModel<TApi>[];
  api?: ProviderStreams | Partial<Record<TApi, ProviderStreams>> | undefined;
  images?: Partial<Record<ImageApi, ProviderImages>> | undefined;
  classifiers?: Partial<Record<ClassifierApi, ProviderClassifier>> | undefined;
}

interface StreamImplementations {
  readonly single: ProviderStreams | undefined;
  readonly byApi: Partial<Record<string, ProviderStreams>> | undefined;
  readonly streams: readonly ProviderStreams[];
}

const streamImplementations = <TApi extends Api>(
  input: CreateProviderOptions<TApi>,
): StreamImplementations => {
  const single =
    input.api !== undefined && typeof (input.api as ProviderStreams).stream === "function"
      ? (input.api as ProviderStreams)
      : undefined;
  const byApi =
    single !== undefined || input.api === undefined
      ? undefined
      : (input.api as Partial<Record<string, ProviderStreams>>);
  const streams =
    single === undefined
      ? Object.values(byApi ?? {}).filter((entry) => entry !== undefined)
      : [single];
  return { single, byApi, streams };
};

const assertHasImplementation = <TApi extends Api>(
  input: CreateProviderOptions<TApi>,
  streams: readonly ProviderStreams[],
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

class DynamicModels<TApi extends Api> {
  private dynamic: readonly ProviderModel<TApi>[] = [];
  private readonly baseline: readonly ProviderModel<TApi>[];

  constructor(baseline: readonly ProviderModel<TApi>[]) {
    this.baseline = baseline;
  }

  set(models: readonly ProviderModel<TApi>[]): void {
    this.dynamic = models;
  }

  current(): readonly ProviderModel<TApi>[] {
    const merged = [...this.baseline];
    for (const model of this.dynamic) {
      const index = merged.findIndex(
        (entry) => getModelType(entry) === getModelType(model) && entry.id === model.id,
      );
      if (index >= 0) merged[index] = model;
      else merged.push(model);
    }
    return merged;
  }
}

interface ModelRefresher<TApi extends Api> {
  readonly providerId: string;
  readonly models: DynamicModels<TApi>;
  readonly fetchModels: (context: RefreshModelsContext) => Promise<readonly ProviderModel<TApi>[]>;
}

const refreshProviderModels =
  <TApi extends Api>({ providerId, models, fetchModels }: ModelRefresher<TApi>) =>
  (context: RefreshModelsContext): Promise<void> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stored = context.stored;
        if (stored !== undefined) {
          const restored = stored.models
            .filter((model) => model.provider === providerId)
            .map((model) => model as ProviderModel<TApi>);
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
            persist: { models: refreshed, checkedAt },
            update: () => models.set(refreshed),
          }),
        );
      }),
    );

const missingDeferred = (providerId: string, model: Model<Api>, action: string) =>
  new ModelsError(
    "provider",
    `Provider ${providerId} ${action} deferred responses for "${model.api}"`,
  );

const attachDeferred = <TApi extends Api>(
  provider: Provider<TApi>,
  implementations: StreamImplementations,
  apiFor: (model: Model<Api>) => ProviderStreams | undefined,
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
};

const dispatcher =
  (providerId: string, apiFor: (model: Model<Api>) => ProviderStreams | undefined) =>
  (
    model: Model<Api>,
    run: (streams: ProviderStreams) => AssistantMessageEventStream,
  ): AssistantMessageEventStream => {
    const providerStreams = apiFor(model);
    if (providerStreams !== undefined) return run(providerStreams);
    return lazyStream(model, () => {
      throw new ModelsError(
        "stream",
        `Provider ${providerId} has no API implementation for "${model.api}"`,
      );
    });
  };

export const createProvider = <TApi extends Api = Api>(
  input: CreateProviderOptions<TApi>,
): Provider<TApi> => {
  const implementations = streamImplementations(input);
  assertHasImplementation(input, implementations.streams);
  const models = new DynamicModels(input.models);
  const apiFor = (model: Model<Api>): ProviderStreams | undefined =>
    implementations.single ?? implementations.byApi?.[model.api];
  const dispatch = dispatcher(input.id, apiFor);

  const provider: Provider<TApi> = {
    id: input.id,
    name: input.name ?? input.id,
    baseUrl: input.baseUrl,
    headers: input.headers,
    auth: input.auth,
    getModels: () =>
      models.current().filter((model): model is Model<TApi> => isModelType(model, "chat")),
    getAllModels: () => models.current(),
    ...(input.filterModels === undefined ? {} : { filterModels: input.filterModels }),
    ...(input.filterAllModels === undefined ? {} : { filterAllModels: input.filterAllModels }),
    stream: (model, context, options) =>
      dispatch(model, (providerStreams) => providerStreams.stream(model, context, options)),
    streamSimple: (model, context, options) =>
      dispatch(model, (providerStreams) => providerStreams.streamSimple(model, context, options)),
  };

  if (input.fetchModels !== undefined) {
    provider.refreshModels = refreshProviderModels({
      providerId: input.id,
      models,
      fetchModels: input.fetchModels,
    });
  }
  attachDeferred(provider, implementations, apiFor);
  attachImages({ provider, input: input.images });
  attachClassifiers({ provider, input: input.classifiers });
  return provider;
};
