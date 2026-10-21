import { Effect } from "effect";

import type resolveTypes from "./auth/resolve.types.ts";
import type typesModule from "./auth/types.ts";
import modelsKit from "./models-kit.ts";
import modelsShared from "./models-shared.ts";
import type modelsStateTypes from "./models-state.types.ts";
import type providerTypesModule from "./models/provider-types.ts";
import type typesModuleModule2 from "./types.types.ts";

const { mergeHeaders, readCredential } = modelsShared;
const { abort: abortModule, modelOperations, modelsError, resolve: resolveModule } = modelsKit;
const { isModelType } = modelOperations;
const { promiseOrModelsError } = modelsError;
const { resolveProviderAuth } = resolveModule;
const { abortable, operationSignal } = abortModule;

interface ProviderAuthCheck {
  readonly state: modelsStateTypes.ModelsState;
  readonly provider: providerTypesModule.Provider;
  readonly credential: typesModule.Credential | undefined;
  readonly signal: AbortSignal;
}

const checkProviderAuth = ({
  state,
  provider,
  credential,
  signal,
}: ProviderAuthCheck): Effect.Effect<typesModule.AuthCheck | undefined> =>
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
            credential: credential?.type === "api_key" ? credential : undefined,
            ctx: state.authContext,
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
  readonly state: modelsStateTypes.ModelsState;
  readonly providerId: string;
  readonly signal: AbortSignal | undefined;
}

const checkAuth = (request: ProviderAuthRequest): Promise<typesModule.AuthCheck | undefined> => {
  const { state, providerId } = request;
  const signal = operationSignal(request.signal);
  return Effect.runPromise(
    abortable(
      Effect.gen(function* () {
        signal.throwIfAborted();
        const provider = state.providers.get(providerId);
        if (provider === undefined) return undefined;
        const credential = yield* readCredential({ providerId, signal, state });
        return yield* checkProviderAuth({ credential, provider, signal, state });
      }),
      signal,
    ),
  );
};

interface AuthenticatedProvider {
  readonly provider: providerTypesModule.Provider;
  readonly credential: typesModule.Credential | undefined;
}

interface AvailabilityRequest {
  readonly state: modelsStateTypes.ModelsState;
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
          const credential = yield* readCredential({ providerId: provider.id, signal, state });
          const auth = yield* checkProviderAuth({ credential, provider, signal, state });
          return { auth, credential, provider };
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

const getAvailable = (
  request: AvailabilityRequest,
): Promise<readonly typesModuleModule2.Model<typesModuleModule2.Api>[]> =>
  availableWith(request, ({ provider, credential }) => {
    const models = provider.getModels();
    return provider.filterModels?.(models, credential) ?? models;
  });

const getAllAvailable = (
  request: AvailabilityRequest,
): Promise<readonly typesModuleModule2.AnyModel[]> =>
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
  readonly state: modelsStateTypes.ModelsState;
  readonly providerOrModel: string | typesModuleModule2.AnyModel;
  readonly overrides: resolveTypes.AuthResolutionOverrides | undefined;
}

const getAuth = ({
  state,
  providerOrModel,
  overrides,
}: GetAuthRequest): Effect.Effect<typesModule.AuthResult | undefined> =>
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

const modelsAuth = {
  authenticatedProviders,
  availableWith,
  checkAuth,
  checkProviderAuth,
  getAllAvailable,
  getAuth,
  getAvailable,
};

export default modelsAuth;
