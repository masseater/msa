import { Function, Clock, Effect, Deferred, Exit } from "effect";

import { lazyStream } from "./api/lazy.ts";
import { defaultProviderAuthContext } from "./auth/context.ts";
import { InMemoryCredentialStore, runAfterPrevious } from "./auth/credential-store.ts";
import {
  resolveProviderAuth,
  refreshStoredOAuthCredential,
  type AuthResolutionOverrides,
} from "./auth/resolve.ts";
import type {
  AuthContext,
  Credential,
  CredentialStore,
  ProviderAuth,
  AuthCheck,
  AuthResult,
  AuthInteraction,
  AuthOperationOptions,
  AuthType,
  LoginOptions,
} from "./auth/types.ts";
import { InMemoryModelsStore, type ModelsStore, type ModelsStoreEntry } from "./models-store.ts";
import type {
  Provider,
  ProviderModel,
  RefreshModelsContext,
  ModelsPublication,
} from "./models/provider-types.ts";
import type {
  CreateModelsOptions,
  ModelsRequestTransforms,
  ModelsRefreshOptions,
  ModelsRefreshResult,
  ModelsApiStreamOptions,
  ModelsClassifierOptions,
  ModelsDeferredCancelOptions,
  ModelsDeferredFetchOptions,
  ModelsImagesOptions,
  ModelsSimpleStreamOptions,
  MutableModels,
} from "./models/types.ts";
import type {
  AnyModel,
  ModelType,
  ProviderHeaders,
  Api,
  Model,
  ModelCostRates,
  ModelThinkingLevel,
  Usage,
  ModelTypeMap,
  ClassifierApi,
  ImageApi,
  ProviderClassifier,
  ProviderImages,
  AssistantMessageEventStream,
  ProviderStreams,
  ProviderRequestOptions,
  ApiStreamOptions,
  AssistantImages,
  ClassifierContext,
  ClassifierModel,
  ClassifierResult,
  Context,
  DeferredFetchOptions,
  DeferredHandle,
  ImageModel,
  ImagesContext,
  SimpleStreamOptions,
  AssistantMessage,
} from "./types.ts";
import { abortable, operationSignal, waitForAbort, raceWithAbortSignal } from "./utils/abort.ts";
import {
  getModelType,
  isModelType,
  classifierErrorResult,
  imageErrorResult,
  assertChatModel,
  assertClassifierInputSupported,
  assertClassifierModel,
  assertImageModel,
} from "./utils/model-operations.ts";
import { promiseOrModelsError, ModelsError } from "./utils/models-error.ts";
import { normalizeContext } from "./utils/transcript.ts";

export { ModelsError, type ModelsErrorCode } from "./auth/resolve.ts";
export type { ModelsPublication, Provider, RefreshModelsContext } from "./models/provider-types.ts";
export type {
  CreateModelsOptions,
  Models,
  ModelsApiStreamOptions,
  ModelsClassifierOptions,
  ModelsDeferredCancelOptions,
  ModelsDeferredFetchOptions,
  ModelsImagesOptions,
  ModelsRefreshOptions,
  ModelsRefreshResult,
  ModelsRequestTransforms,
  ModelsSimpleStreamOptions,
  MutableModels,
} from "./models/types.ts";
export { getModelType, isModelType } from "./utils/model-operations.ts";

interface ModelsState {
  readonly providers: Map<string, Provider>;
  readonly credentials: CredentialStore;
  readonly modelsStore: ModelsStore;
  readonly authContext: AuthContext;
  readonly refreshGenerations: Map<string, number>;
  readonly refreshControllers: Map<string, AbortController>;
  readonly publicationChains: Map<string, Promise<unknown>>;
}

const createModelsState = (options?: CreateModelsOptions): ModelsState => ({
  providers: new Map(),
  credentials: options?.credentials ?? new InMemoryCredentialStore(),
  modelsStore: options?.modelsStore ?? new InMemoryModelsStore(),
  authContext: options?.authContext ?? defaultProviderAuthContext(),
  refreshGenerations: new Map(),
  refreshControllers: new Map(),
  publicationChains: new Map(),
});

const KNOWN_MODEL_TYPES: Record<ModelType, true> = { chat: true, image: true, classifier: true };

const hasKnownModelType = (model: AnyModel): boolean =>
  Object.hasOwn(KNOWN_MODEL_TYPES, getModelType(model));

const withKnownModelTypes = (entry: ModelsStoreEntry): ModelsStoreEntry => ({
  ...entry,
  models: entry.models.filter(hasKnownModelType),
});

interface HeaderLayers {
  readonly base: ProviderHeaders | undefined;
  readonly override: ProviderHeaders | undefined;
}

const mergeHeaders = ({ base, override }: HeaderLayers): ProviderHeaders | undefined => {
  if (base === undefined && override === undefined) return undefined;
  const merged = { ...base };
  for (const [name, value] of Object.entries(override ?? {})) {
    const lowerName = name.toLowerCase();
    for (const existingName of Object.keys(merged)) {
      if (existingName.toLowerCase() === lowerName) delete merged[existingName];
    }
    merged[name] = value;
  }
  return merged;
};

interface CredentialRead {
  readonly state: ModelsState;
  readonly providerId: string;
  readonly signal: AbortSignal;
}

const readCredential = ({
  state,
  providerId,
  signal,
}: CredentialRead): Effect.Effect<Credential | undefined> =>
  promiseOrModelsError(() => state.credentials.read(providerId, { signal }), {
    code: "auth",
    message: `Credential store read failed for ${providerId}`,
  });

export const hasApi: {
  <TApi extends Api>(api: TApi): (model: AnyModel) => model is Model<TApi>;
  <TApi extends Api>(model: AnyModel, api: TApi): model is Model<TApi>;
} = Function.dual(
  2,
  <TApi extends Api>(model: AnyModel, api: TApi): model is Model<TApi> =>
    isModelType(model, "chat") && model.api === api,
);

const costRates = (model: AnyModel, inputTokens: number): ModelCostRates => {
  let rates: ModelCostRates = model.cost;
  let matchedThreshold = -1;
  for (const tier of model.cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier;
      matchedThreshold = tier.inputTokensAbove;
    }
  }
  return rates;
};

export const calculateCost: {
  (usage: Usage): (model: AnyModel) => Usage["cost"];
  (model: AnyModel, usage: Usage): Usage["cost"];
} = Function.dual(2, (model: AnyModel, usage: Usage): Usage["cost"] => {
  const rates = costRates(model, usage.input + usage.cacheRead + usage.cacheWrite);
  const longWrite = usage.cacheWrite1h ?? 0;
  const shortWrite = usage.cacheWrite - longWrite;
  usage.cost.input = (rates.input / 1000000) * usage.input;
  usage.cost.output = (rates.output / 1000000) * usage.output;
  usage.cost.cacheRead = (rates.cacheRead / 1000000) * usage.cacheRead;
  usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1000000;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
  return usage.cost;
});

const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const getSupportedThinkingLevels = <TApi extends Api>(
  model: Model<TApi>,
): ModelThinkingLevel[] => {
  if (!model.reasoning) return ["off"];

  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
};

export const clampThinkingLevel: {
  (level: ModelThinkingLevel): <TApi extends Api>(model: Model<TApi>) => ModelThinkingLevel;
  <TApi extends Api>(model: Model<TApi>, level: ModelThinkingLevel): ModelThinkingLevel;
} = Function.dual(
  2,
  <TApi extends Api>(model: Model<TApi>, level: ModelThinkingLevel): ModelThinkingLevel => {
    const availableLevels = getSupportedThinkingLevels(model);
    if (availableLevels.includes(level)) return level;

    const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
    if (requestedIndex === -1) return availableLevels[0] ?? "off";

    const above = EXTENDED_THINKING_LEVELS.slice(requestedIndex);
    const below = EXTENDED_THINKING_LEVELS.slice(0, requestedIndex).reverse();
    return (
      [...above, ...below].find((candidate) => availableLevels.includes(candidate)) ??
      availableLevels[0] ??
      "off"
    );
  },
);

export const modelsAreEqual: {
  (b: AnyModel | null | undefined): (a: AnyModel | null | undefined) => boolean;
  (a: AnyModel | null | undefined, b: AnyModel | null | undefined): boolean;
} = Function.dual(2, (a: AnyModel | null | undefined, b: AnyModel | null | undefined): boolean => {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return getModelType(a) === getModelType(b) && a.id === b.id && a.provider === b.provider;
});

const modelsOrEmpty = <A>(read: () => readonly A[]): readonly A[] => {
  try {
    return read();
  } catch {
    return [];
  }
};

interface CatalogQuery {
  readonly state: ModelsState;
  readonly provider: string | undefined;
}

const collect = <A>(
  { state, provider }: CatalogQuery,
  read: (entry: Provider) => readonly A[],
): readonly A[] => {
  if (provider !== undefined) {
    const entry = state.providers.get(provider);
    return entry === undefined ? [] : modelsOrEmpty(() => read(entry));
  }
  return [...state.providers.values()].flatMap((entry) => modelsOrEmpty(() => read(entry)));
};

const listModels = (query: CatalogQuery): readonly Model<Api>[] =>
  collect(query, (entry) => entry.getModels());

const listAllModels = (query: CatalogQuery): readonly AnyModel[] =>
  collect<AnyModel>(query, (entry) => entry.getAllModels?.() ?? entry.getModels());

const ofType: {
  <TType extends ModelType>(
    type: TType,
  ): (models: readonly AnyModel[]) => readonly ModelTypeMap[TType][];
  <TType extends ModelType>(
    models: readonly AnyModel[],
    type: TType,
  ): readonly ModelTypeMap[TType][];
} = Function.dual(
  2,
  <TType extends ModelType>(
    models: readonly AnyModel[],
    type: TType,
  ): readonly ModelTypeMap[TType][] =>
    models.filter((model): model is ModelTypeMap[TType] => isModelType(model, type)),
);

const presentCount = (record: Partial<Record<string, unknown>>): number =>
  Object.values(record).filter((entry) => entry !== undefined).length;

interface ImageCapabilities<TApi extends Api> {
  readonly provider: Provider<TApi>;
  readonly input: Partial<Record<ImageApi, ProviderImages>> | undefined;
}

const attachImages = <TApi extends Api>({ provider, input }: ImageCapabilities<TApi>): void => {
  const images = input as Partial<Record<string, ProviderImages>> | undefined;
  if (images === undefined || presentCount(images) === 0) return;
  provider.generateImages = (model, context, options) => {
    const implementation = images[model.api];
    if (implementation === undefined) {
      return Promise.resolve(
        imageErrorResult(
          model,
          new ModelsError(
            "provider",
            `Provider ${provider.id} has no image generation implementation for "${model.api}"`,
          ),
        ),
      );
    }
    try {
      return implementation.generateImages(model, context, options);
    } catch (error) {
      return Promise.reject(error);
    }
  };
};

interface ClassifierCapabilities<TApi extends Api> {
  readonly provider: Provider<TApi>;
  readonly input: Partial<Record<ClassifierApi, ProviderClassifier>> | undefined;
}

const attachClassifiers = <TApi extends Api>({
  provider,
  input,
}: ClassifierCapabilities<TApi>): void => {
  const classifiers = input as Partial<Record<string, ProviderClassifier>> | undefined;
  if (classifiers === undefined || presentCount(classifiers) === 0) return;
  provider.classify = (model, context, options) => {
    const implementation = classifiers[model.api];
    if (implementation === undefined) {
      return Promise.resolve(
        classifierErrorResult(
          model,
          new ModelsError(
            "provider",
            `Provider ${provider.id} has no classifier implementation for "${model.api}"`,
          ),
        ),
      );
    }
    try {
      return implementation.classify(model, context, options);
    } catch (error) {
      return Promise.reject(error);
    }
  };
};

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

const refreshFetchedModels =
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
    provider.refreshModels = refreshFetchedModels({
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

interface ProviderAuthCheck {
  readonly state: ModelsState;
  readonly provider: Provider;
  readonly credential: Credential | undefined;
  readonly signal: AbortSignal;
}

const checkProviderAuth = ({
  state,
  provider,
  credential,
  signal,
}: ProviderAuthCheck): Effect.Effect<AuthCheck | undefined> =>
  Effect.gen(function* () {
    if (credential?.type === "oauth") {
      return provider.auth.oauth === undefined
        ? undefined
        : { source: "OAuth", type: "oauth" as const };
    }
    const apiKey = provider.auth.apiKey;
    if (apiKey === undefined) return undefined;
    const check = apiKey.check?.bind(apiKey);
    if (check !== undefined) {
      return yield* promiseOrModelsError(
        () =>
          check({
            ctx: state.authContext,
            credential: credential?.type === "api_key" ? credential : undefined,
            signal,
          }),
        { code: "auth", message: `API key auth check failed for provider ${provider.id}` },
      );
    }

    const resolution = yield* resolveProviderAuth(provider, state.credentials, state.authContext, {
      signal,
    });
    return resolution === undefined
      ? undefined
      : { source: resolution.source, type: "api_key" as const };
  });

interface ProviderAuthRequest {
  readonly state: ModelsState;
  readonly providerId: string;
  readonly signal: AbortSignal | undefined;
}

const checkAuth = (request: ProviderAuthRequest): Promise<AuthCheck | undefined> => {
  const { state, providerId } = request;
  const signal = operationSignal(request.signal);
  return Effect.runPromise(
    abortable(
      Effect.gen(function* () {
        signal.throwIfAborted();
        const provider = state.providers.get(providerId);
        if (provider === undefined) return undefined;
        const credential = yield* readCredential({ state, providerId, signal });
        return yield* checkProviderAuth({ state, provider, credential, signal });
      }),
      signal,
    ),
  );
};

interface AuthenticatedProvider {
  readonly provider: Provider;
  readonly credential: Credential | undefined;
}

interface AvailabilityRequest {
  readonly state: ModelsState;
  readonly providerId: string | undefined;
  readonly signal: AbortSignal | undefined;
}

const authenticatedProviders = (
  request: AvailabilityRequest,
  signal: AbortSignal,
): Effect.Effect<readonly AuthenticatedProvider[]> =>
  Effect.gen(function* () {
    const { state, providerId } = request;
    signal.throwIfAborted();
    const providers =
      providerId !== undefined && providerId !== ""
        ? [state.providers.get(providerId)].filter((entry) => entry !== undefined)
        : Array.from(state.providers.values());
    const checks = yield* Effect.forEach(
      providers,
      (provider) =>
        Effect.gen(function* () {
          const credential = yield* readCredential({ state, providerId: provider.id, signal });
          const auth = yield* checkProviderAuth({ state, provider, credential, signal });
          return { provider, credential, auth };
        }),
      { concurrency: "unbounded" },
    );
    return checks.filter((entry) => entry.auth !== undefined);
  });

const availableWith = <A>(
  request: AvailabilityRequest,
  select: (entry: AuthenticatedProvider) => readonly A[],
): Promise<readonly A[]> => {
  const signal = operationSignal(request.signal);
  return Effect.runPromise(
    abortable(
      authenticatedProviders(request, signal).pipe(
        Effect.map((providers) => providers.flatMap(select)),
      ),
      signal,
    ),
  );
};

const getAvailable = (request: AvailabilityRequest): Promise<readonly Model<Api>[]> =>
  availableWith(request, ({ provider, credential }) => {
    const models = provider.getModels();
    return provider.filterModels?.(models, credential) ?? models;
  });

const getAllAvailable = (request: AvailabilityRequest): Promise<readonly AnyModel[]> =>
  availableWith(request, ({ provider, credential }) => {
    const models = provider.getAllModels?.() ?? provider.getModels();
    if (provider.filterAllModels !== undefined) return provider.filterAllModels(models, credential);
    if (provider.filterModels === undefined) return models;
    const availableChatIds = new Set(
      provider.filterModels(provider.getModels(), credential).map((model) => model.id),
    );
    return models.filter((model) => !isModelType(model, "chat") || availableChatIds.has(model.id));
  });

interface GetAuthRequest {
  readonly state: ModelsState;
  readonly providerOrModel: string | AnyModel;
  readonly overrides: AuthResolutionOverrides | undefined;
}

const getAuth = ({
  state,
  providerOrModel,
  overrides,
}: GetAuthRequest): Effect.Effect<AuthResult | undefined> =>
  Effect.gen(function* () {
    const signal = operationSignal(overrides?.signal);
    const providerId =
      typeof providerOrModel === "string" ? providerOrModel : providerOrModel.provider;
    const provider = state.providers.get(providerId);
    if (provider === undefined) return undefined;
    const result = yield* resolveProviderAuth(provider, state.credentials, state.authContext, {
      ...overrides,
      signal,
    });
    if (
      result === undefined ||
      typeof providerOrModel === "string" ||
      providerOrModel.headers === undefined
    )
      return result;
    return {
      ...result,
      auth: {
        ...result.auth,
        headers: mergeHeaders({ base: result.auth.headers, override: providerOrModel.headers }),
      },
    };
  });

interface ProviderLookup {
  readonly state: ModelsState;
  readonly model: AnyModel;
}

const requireProvider = ({ state, model }: ProviderLookup): Provider => {
  const provider = state.providers.get(model.provider);
  if (provider === undefined) {
    throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
  }
  return provider;
};

interface ChatProviderLookup {
  readonly state: ModelsState;
  readonly model: Model<Api>;
}

const requireChatProvider = ({ state, model }: ChatProviderLookup): Provider => {
  assertChatModel(model);
  return requireProvider({ state, model });
};

interface AuthorizedRequest<TModel extends AnyModel, TOptions> {
  readonly requestModel: TModel;
  readonly requestOptions: Omit<TOptions, "transformHeaders"> & ProviderRequestOptions<TModel>;
}

interface ApplyAuthRequest<TModel extends AnyModel, TOptions> {
  readonly state: ModelsState;
  readonly model: TModel;
  readonly options: TOptions | undefined;
}

const applyAuth = <
  TModel extends AnyModel,
  TOptions extends ProviderRequestOptions<TModel> & ModelsRequestTransforms,
>({
  state,
  model,
  options,
}: ApplyAuthRequest<TModel, TOptions>): Effect.Effect<AuthorizedRequest<TModel, TOptions>> =>
  Effect.gen(function* () {
    requireProvider({ state, model });
    const resolution = yield* getAuth({
      state,
      providerOrModel: model,
      overrides: { apiKey: options?.apiKey, env: options?.env, signal: options?.signal },
    });
    if (resolution === undefined) {
      return yield* Effect.die(
        new ModelsError("auth", `Provider is not configured: ${model.provider}`),
      );
    }
    const auth = resolution.auth;

    const apiKey = options?.apiKey ?? auth.apiKey;
    let headers = mergeHeaders({ base: auth.headers, override: options?.headers });
    const transformHeaders = options?.transformHeaders;
    if (transformHeaders !== undefined) {
      const current = headers ?? {};
      headers = yield* Effect.promise(() => Promise.resolve(transformHeaders(current)));
    }
    const env =
      resolution.env !== undefined || options?.env !== undefined
        ? { ...(resolution.env ?? {}), ...(options?.env ?? {}) }
        : undefined;
    const requestModel: TModel =
      auth.baseUrl !== undefined && auth.baseUrl !== ""
        ? { ...model, baseUrl: auth.baseUrl }
        : model;
    const { transformHeaders: _transformHeaders, ...providerOptions } = options ?? {};
    const requestOptions = { ...providerOptions, apiKey, headers, env } as Omit<
      TOptions,
      "transformHeaders"
    > &
      ProviderRequestOptions<TModel>;

    return { requestModel, requestOptions };
  });

const storeCredential = (
  state: ModelsState,
  providerId: string,
  credential: Credential,
  signal: AbortSignal,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    let mutationStarted = false;
    const started = Deferred.makeUnsafe<void>();
    const mutation = state.credentials.modify(
      providerId,
      () => {
        mutationStarted = true;
        Deferred.doneUnsafe(started, Exit.void);
        return Promise.resolve(credential);
      },
      { signal },
    );
    void mutation.catch(() => {});
    const startedOrSettled = Effect.raceFirst(
      Deferred.await(started),
      Effect.promise(() => mutation).pipe(Effect.asVoid),
    );
    const abortedBeforeStart = waitForAbort(signal).pipe(
      Effect.flatMap(() => (mutationStarted ? Effect.never : Effect.die(signal.reason))),
    );
    yield* Effect.raceFirst(startedOrSettled, abortedBeforeStart).pipe(
      Effect.andThen(Effect.promise(() => mutation)),
      Effect.catchDefect((error) =>
        Effect.sync(() => signal.throwIfAborted()).pipe(
          Effect.andThen(
            Effect.die(
              new ModelsError("auth", `Credential store modify failed for ${providerId}`, {
                cause: error,
              }),
            ),
          ),
        ),
      ),
    );
  });

interface LoginRequest {
  readonly state: ModelsState;
  readonly providerId: string;
  readonly type: AuthType;
  readonly interaction: AuthInteraction;
  readonly options: LoginOptions | undefined;
}

const login = (request: LoginRequest): Effect.Effect<Credential> =>
  Effect.gen(function* () {
    const { state, providerId, type, interaction } = request;
    const signal = operationSignal(interaction.signal);
    signal.throwIfAborted();
    const provider = state.providers.get(providerId);
    if (provider === undefined)
      return yield* Effect.die(new ModelsError("provider", `Unknown provider: ${providerId}`));
    const method = type === "oauth" ? provider.auth.oauth : provider.auth.apiKey;
    const loginMethod = method?.login?.bind(method);
    if (loginMethod === undefined) {
      return yield* Effect.die(
        new ModelsError("auth", `${provider.name} does not support ${type} login`),
      );
    }
    const loginOperation: Promise<Credential> = loginMethod(
      { ...interaction, signal },
      request.options,
    );
    const credential = yield* abortable(
      Effect.promise(() => loginOperation),
      signal,
    );
    yield* storeCredential(state, providerId, credential, signal);
    return credential;
  });

interface LogoutRequest {
  readonly state: ModelsState;
  readonly providerId: string;
  readonly options: AuthOperationOptions | undefined;
}

const logout = ({ state, providerId, options }: LogoutRequest): Effect.Effect<void> =>
  Effect.gen(function* () {
    const signal = operationSignal(options?.signal);
    signal.throwIfAborted();
    yield* Effect.promise(() => state.credentials.delete(providerId, { signal })).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => signal.throwIfAborted()).pipe(
          Effect.andThen(
            Effect.die(
              new ModelsError("auth", `Credential store delete failed for ${providerId}`, {
                cause: error,
              }),
            ),
          ),
        ),
      ),
    );
  });

type RefreshableProvider = Provider & Required<Pick<Provider, "refreshModels">>;

interface ProviderRefreshTarget {
  readonly state: ModelsState;
  readonly providerId: string;
}

const supersedeProviderRefresh = ({ state, providerId }: ProviderRefreshTarget): number => {
  const generation = (state.refreshGenerations.get(providerId) ?? 0) + 1;
  state.refreshGenerations.set(providerId, generation);
  const previous = state.refreshControllers.get(providerId);
  if (previous !== undefined) {
    state.refreshControllers.delete(providerId);
    previous.abort();
  }
  return generation;
};

const beginProviderRefresh = (target: ProviderRefreshTarget) => {
  const generation = supersedeProviderRefresh(target);
  const controller = new AbortController();
  target.state.refreshControllers.set(target.providerId, controller);
  return { generation, controller };
};

interface ProviderRefreshRun {
  readonly state: ModelsState;
  readonly provider: RefreshableProvider;
  readonly generation: number;
  readonly signal: AbortSignal;
}

const publishProviderModels = (
  run: ProviderRefreshRun,
  publication: ModelsPublication,
): Promise<boolean> => {
  const { state, provider, generation, signal } = run;
  const isCurrent = () =>
    !signal.aborted && state.refreshGenerations.get(provider.id) === generation;
  const queued = runAfterPrevious({
    chains: state.publicationChains,
    key: provider.id,
    task: Effect.gen(function* () {
      if (!isCurrent()) return false;
      const persist = publication.persist;
      if (persist === null) {
        yield* Effect.promise(() => state.modelsStore.delete(provider.id, { signal }));
      } else if (persist !== undefined) {
        yield* Effect.promise(() =>
          state.modelsStore.write(provider.id, structuredClone(persist), { signal }),
        );
      }
      if (!isCurrent()) return false;
      publication.update?.();
      return true;
    }),
  });
  return raceWithAbortSignal(queued, signal);
};

interface RefreshPhase {
  readonly credential: Credential | undefined;
  readonly allowNetwork: boolean;
  readonly force: boolean | undefined;
}

const runProviderRefreshPhase = (
  run: ProviderRefreshRun,
  phase: RefreshPhase,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { state, provider, signal } = run;
    const stored = yield* Effect.promise(() => state.modelsStore.read(provider.id, { signal }));
    yield* Effect.promise(() =>
      provider.refreshModels({
        credential: phase.credential,
        stored: stored === undefined ? undefined : withKnownModelTypes(structuredClone(stored)),
        publish: (publication) => publishProviderModels(run, publication),
        allowNetwork: phase.allowNetwork,
        force: phase.allowNetwork ? phase.force : undefined,
        signal,
        baseUrl: provider.baseUrl,
      }),
    );
  });

const resolveRefreshCredential = (
  run: ProviderRefreshRun,
  stored: Credential | undefined,
): Effect.Effect<Credential | undefined> =>
  Effect.gen(function* () {
    const { state, provider, signal } = run;
    if (stored?.type === "oauth") {
      const oauth = provider.auth.oauth;
      if (oauth === undefined) return undefined;
      const clock = yield* Clock.Clock;
      if (clock.currentTimeMillisUnsafe() < stored.expires) return stored;
      if (signal.aborted) return undefined;
      return yield* refreshStoredOAuthCredential(
        state.credentials,
        provider.id,
        oauth,
        (current) => clock.currentTimeMillisUnsafe() >= current.expires,
        signal,
      );
    }

    const apiKey = provider.auth.apiKey;
    if (apiKey === undefined) return undefined;
    const credential = stored?.type === "api_key" ? stored : undefined;
    const result = yield* Effect.promise(() =>
      apiKey.resolve({ ctx: state.authContext, credential, signal }),
    );
    if (result === undefined) return undefined;
    return { type: "api_key" as const, key: result.auth.apiKey, env: result.env };
  });

const refreshProviderModels = (
  run: ProviderRefreshRun,
  options: ModelsRefreshOptions,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const read = yield* readCredential({
      state: run.state,
      providerId: run.provider.id,
      signal: run.signal,
    }).pipe(
      Effect.map((credential) => ({ credential, error: undefined as unknown })),
      Effect.catchDefect((error) => Effect.succeed({ credential: undefined, error })),
    );

    yield* runProviderRefreshPhase(run, {
      credential: read.credential,
      allowNetwork: false,
      force: undefined,
    });
    if (read.error !== undefined) return yield* Effect.die(read.error);
    if (options.allowNetwork === false || run.signal.aborted) return;

    const credential = yield* resolveRefreshCredential(run, read.credential);
    if (credential === undefined) return;
    yield* runProviderRefreshPhase(run, { credential, allowNetwork: true, force: options.force });
  });

interface ProviderRefreshRequest {
  readonly state: ModelsState;
  readonly provider: RefreshableProvider;
  readonly callerSignal: AbortSignal;
  readonly options: ModelsRefreshOptions;
  readonly errors: Map<string, Error>;
}

const refreshProvider = (request: ProviderRefreshRequest): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { state, provider, errors } = request;
    const { generation, controller } = beginProviderRefresh({ state, providerId: provider.id });
    const signal = AbortSignal.any([request.callerSignal, controller.signal]);
    yield* abortable(
      refreshProviderModels({ state, provider, generation, signal }, request.options),
      signal,
    ).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => {
          if (signal.aborted) return;
          errors.set(
            provider.id,
            error instanceof Error
              ? error
              : new ModelsError("model_source", `Model refresh failed for ${provider.id}`, {
                  cause: error,
                }),
          );
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (state.refreshControllers.get(provider.id) === controller) {
            state.refreshControllers.delete(provider.id);
          }
        }),
      ),
    );
  });

interface ModelsRefreshRequest {
  readonly state: ModelsState;
  readonly options: ModelsRefreshOptions;
}

const refreshModels = ({
  state,
  options,
}: ModelsRefreshRequest): Effect.Effect<ModelsRefreshResult> =>
  Effect.gen(function* () {
    const callerSignal = operationSignal(options.signal);
    const errors = new Map<string, Error>();
    if (callerSignal.aborted) return { aborted: true, errors };
    const selected = options.providers === undefined ? undefined : new Set(options.providers);
    const refreshable = Array.from(state.providers.values()).filter(
      (provider): provider is RefreshableProvider =>
        provider.refreshModels !== undefined &&
        (selected === undefined || selected.has(provider.id)),
    );

    const refresh = Effect.forEach(
      refreshable,
      (provider) => refreshProvider({ state, provider, callerSignal, options, errors }),
      { concurrency: "unbounded", discard: true },
    );
    yield* abortable(refresh, callerSignal).pipe(
      Effect.catchDefect((error) => (callerSignal.aborted ? Effect.void : Effect.die(error))),
    );

    return { aborted: callerSignal.aborted, errors: new Map(errors) };
  });

interface StreamRequest<TApi extends Api, TOptions> {
  readonly state: ModelsState;
  readonly model: Model<TApi>;
  readonly context: Context;
  readonly options: TOptions | undefined;
}

const streamModel = <TApi extends Api>({
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

const streamModelSimple = ({
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

interface DeferredRequest<TOptions> {
  readonly state: ModelsState;
  readonly model: Model<Api>;
  readonly handle: DeferredHandle;
  readonly options: TOptions | undefined;
}

const unsupportedDeferred = (model: Model<Api>) =>
  new ModelsError("provider", `Provider ${model.provider} does not support deferred responses`);

const streamDeferred = ({
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

const cancelDeferred = ({
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

interface ImagesRequest {
  readonly state: ModelsState;
  readonly model: ImageModel<ImageApi>;
  readonly context: ImagesContext;
  readonly options: ModelsImagesOptions | undefined;
}

const generateImages = ({
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

interface ClassifyRequest {
  readonly state: ModelsState;
  readonly model: ClassifierModel<ClassifierApi>;
  readonly context: ClassifierContext;
  readonly options: ModelsClassifierOptions | undefined;
}

const classify = ({ state, model, context, options }: ClassifyRequest): Promise<ClassifierResult> =>
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

class ModelsImpl implements MutableModels {
  private readonly state: ModelsState;

  constructor(options?: CreateModelsOptions) {
    this.state = createModelsState(options);
  }

  setProvider(provider: Provider): void {
    supersedeProviderRefresh({ state: this.state, providerId: provider.id });
    this.state.providers.set(provider.id, provider);
  }

  deleteProvider(id: string): void {
    supersedeProviderRefresh({ state: this.state, providerId: id });
    this.state.providers.delete(id);
  }

  clearProviders(): void {
    const { providers, refreshControllers } = this.state;
    for (const id of new Set([...providers.keys(), ...refreshControllers.keys()])) {
      supersedeProviderRefresh({ state: this.state, providerId: id });
    }
    providers.clear();
  }

  getProviders(): readonly Provider[] {
    return Array.from(this.state.providers.values());
  }

  getProvider(id: string): Provider | undefined {
    return this.state.providers.get(id);
  }

  getModels(provider?: string): readonly Model<Api>[] {
    return listModels({ state: this.state, provider });
  }

  getAllModels(provider?: string): readonly AnyModel[] {
    return listAllModels({ state: this.state, provider });
  }

  getModelsOfType<TType extends ModelType>(
    type: TType,
    provider?: string,
  ): readonly ModelTypeMap[TType][] {
    return ofType(this.getAllModels(provider), type);
  }

  getModel(provider: string, id: string): Model<Api> | undefined {
    return this.getModels(provider).find((model) => model.id === id);
  }

  getModelOfType<TType extends ModelType>(
    type: TType,
    provider: string,
    id: string,
  ): ModelTypeMap[TType] | undefined {
    return this.getModelsOfType(type, provider).find((model) => model.id === id);
  }

  refresh(options: ModelsRefreshOptions = {}): Promise<ModelsRefreshResult> {
    return Effect.runPromise(refreshModels({ state: this.state, options }));
  }

  checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined> {
    return checkAuth({ state: this.state, providerId, signal: options?.signal });
  }

  getAvailable(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly Model<Api>[]> {
    return getAvailable({ state: this.state, providerId, signal: options?.signal });
  }

  getAvailableOfType<TType extends ModelType>(
    type: TType,
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly ModelTypeMap[TType][]> {
    return Effect.runPromise(
      Effect.promise(() => this.getAllAvailable(providerId, options)).pipe(
        Effect.map((models) => ofType(models, type)),
      ),
    );
  }

  getAllAvailable(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly AnyModel[]> {
    return getAllAvailable({ state: this.state, providerId, signal: options?.signal });
  }

  getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
  getAuth(model: AnyModel, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
  getAuth(
    providerOrModel: string | AnyModel,
    overrides?: AuthResolutionOverrides,
  ): Promise<AuthResult | undefined> {
    return Effect.runPromise(getAuth({ state: this.state, providerOrModel, overrides }));
  }

  login(
    providerId: string,
    type: AuthType,
    interaction: AuthInteraction,
    options?: LoginOptions,
  ): Promise<Credential> {
    return Effect.runPromise(login({ state: this.state, providerId, type, interaction, options }));
  }

  logout(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return Effect.runPromise(logout({ state: this.state, providerId, options }));
  }

  stream<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): AssistantMessageEventStream {
    return streamModel({ state: this.state, model, context, options });
  }

  complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): Promise<AssistantMessage> {
    try {
      return this.stream(model, context, options).result();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): AssistantMessageEventStream {
    return streamModelSimple({ state: this.state, model, context, options });
  }

  completeSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): Promise<AssistantMessage> {
    try {
      return this.streamSimple(model, context, options).result();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  streamDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): AssistantMessageEventStream {
    return streamDeferred({ state: this.state, model, handle, options });
  }

  fetchDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): Promise<AssistantMessage> {
    return this.streamDeferred(model, handle, options).result();
  }

  cancelDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredCancelOptions,
  ): Promise<void> {
    return cancelDeferred({ state: this.state, model, handle, options });
  }

  generateImages(
    model: ImageModel<ImageApi>,
    context: ImagesContext,
    options?: ModelsImagesOptions,
  ): Promise<AssistantImages> {
    return generateImages({ state: this.state, model, context, options });
  }

  classify(
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options?: ModelsClassifierOptions,
  ): Promise<ClassifierResult> {
    return classify({ state: this.state, model, context, options });
  }
}

export const createModels = (options?: CreateModelsOptions): MutableModels =>
  new ModelsImpl(options);
