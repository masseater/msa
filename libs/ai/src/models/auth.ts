import { Effect } from "effect";

import { type AuthResolutionOverrides, resolveProviderAuth } from "../auth/resolve.ts";
import type { AuthCheck, AuthResult, Credential } from "../auth/types.ts";
import type { AnyModel, Api, Model } from "../types.ts";
import { abortable, operationSignal } from "../utils/abort.ts";
import { isModelType } from "../utils/model-operations.ts";
import { promiseOrModelsError } from "../utils/models-error.ts";
import type { Provider } from "./provider-types.ts";
import { mergeHeaders, type ModelsState, readCredential } from "./state.ts";

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

export interface ProviderAuthRequest {
  readonly state: ModelsState;
  readonly providerId: string;
  readonly signal: AbortSignal | undefined;
}

export const checkAuth = (request: ProviderAuthRequest): Promise<AuthCheck | undefined> => {
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

export interface AvailabilityRequest {
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

export const getAvailable = (request: AvailabilityRequest): Promise<readonly Model<Api>[]> =>
  availableWith(request, ({ provider, credential }) => {
    const models = provider.getModels();
    return provider.filterModels?.(models, credential) ?? models;
  });

export const getAllAvailable = (request: AvailabilityRequest): Promise<readonly AnyModel[]> =>
  availableWith(request, ({ provider, credential }) => {
    const models = provider.getAllModels?.() ?? provider.getModels();
    if (provider.filterAllModels !== undefined) return provider.filterAllModels(models, credential);
    if (provider.filterModels === undefined) return models;
    const availableChatIds = new Set(
      provider.filterModels(provider.getModels(), credential).map((model) => model.id),
    );
    return models.filter((model) => !isModelType(model, "chat") || availableChatIds.has(model.id));
  });

export interface GetAuthRequest {
  readonly state: ModelsState;
  readonly providerOrModel: string | AnyModel;
  readonly overrides: AuthResolutionOverrides | undefined;
}

export const getAuth = ({
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
