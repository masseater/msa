import { Deferred, Effect, Exit } from "effect";

import type typesModule from "./auth/types.ts";
import modelsAuth from "./models-auth.ts";
import modelsKit from "./models-kit.ts";
import modelsShared from "./models-shared.ts";
import type modelsStateTypes from "./models-state.types.ts";
import type providerTypesModule from "./models/provider-types.ts";
import type typesModuleModule from "./models/types.ts";
import type typesModuleModule2 from "./types.types.ts";

const { getAuth } = modelsAuth;
const { mergeHeaders } = modelsShared;
const { abort: abortModule, modelOperations, modelsError } = modelsKit;
const { ModelsError } = modelsError;
const { abortable, operationSignal, waitForAbort } = abortModule;

const assertChatModel: typeof modelOperations.assertChatModel = modelOperations.assertChatModel;

interface ProviderLookup {
  readonly state: modelsStateTypes.ModelsState;
  readonly model: typesModuleModule2.AnyModel;
}

const requireProvider = ({ state, model }: ProviderLookup): providerTypesModule.Provider => {
  const provider = state.providers.get(model.provider);
  if (provider === undefined) {
    throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
  }
  return provider;
};

interface ChatProviderLookup {
  readonly state: modelsStateTypes.ModelsState;
  readonly model: typesModuleModule2.Model<typesModuleModule2.Api>;
}

const requireChatProvider = ({
  state,
  model,
}: ChatProviderLookup): providerTypesModule.Provider => {
  assertChatModel(model);
  return requireProvider({ model, state });
};

interface AuthorizedRequest<TModel extends typesModuleModule2.AnyModel, TOptions> {
  readonly requestModel: TModel;
  readonly requestOptions: Omit<TOptions, "transformHeaders"> &
    typesModuleModule2.ProviderRequestOptions<TModel>;
}

type AuthOverrides = Parameters<typeof getAuth>[0]["overrides"];

interface AuthorizeRequest<TModel extends typesModuleModule2.AnyModel, TOptions> {
  readonly model: TModel;
  readonly options: TOptions | undefined;
  readonly resolve: (overrides: AuthOverrides) => Effect.Effect<typesModule.AuthResult | undefined>;
}

const authorize = <
  TModel extends typesModuleModule2.AnyModel,
  TOptions extends typesModuleModule2.ProviderRequestOptions<TModel> &
    typesModuleModule.ModelsRequestTransforms,
>({
  model,
  options,
  resolve,
}: AuthorizeRequest<TModel, TOptions>): Effect.Effect<AuthorizedRequest<TModel, TOptions>> =>
  Effect.gen(function* () {
    const resolution = yield* resolve({
      apiKey: options?.apiKey,
      env: options?.env,
      signal: options?.signal,
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
        ? { ...resolution.env, ...options?.env }
        : undefined;
    const requestModel: TModel =
      auth.baseUrl !== undefined && auth.baseUrl !== ""
        ? { ...model, baseUrl: auth.baseUrl }
        : model;
    const { transformHeaders: _transformHeaders, ...providerOptions } = options ?? {};
    const requestOptions = { ...providerOptions, apiKey, env, headers } as Omit<
      TOptions,
      "transformHeaders"
    > &
      typesModuleModule2.ProviderRequestOptions<TModel>;

    return { requestModel, requestOptions };
  });

interface ApplyAuthRequest<TModel extends typesModuleModule2.AnyModel, TOptions> {
  readonly state: modelsStateTypes.ModelsState;
  readonly model: TModel;
  readonly options: TOptions | undefined;
}

const applyAuth = <
  TModel extends typesModuleModule2.AnyModel,
  TOptions extends typesModuleModule2.ProviderRequestOptions<TModel> &
    typesModuleModule.ModelsRequestTransforms,
>({
  state,
  model,
  options,
}: ApplyAuthRequest<TModel, TOptions>): Effect.Effect<AuthorizedRequest<TModel, TOptions>> =>
  Effect.gen(function* () {
    requireProvider({ model, state });
    return yield* authorize({
      model,
      options,
      resolve: (overrides) => getAuth({ overrides, providerOrModel: model, state }),
    });
  });

const storeCredential = (
  state: modelsStateTypes.ModelsState,
  providerId: string,
  credential: typesModule.Credential,
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
  readonly state: modelsStateTypes.ModelsState;
  readonly providerId: string;
  readonly type: typesModule.AuthType;
  readonly interaction: typesModule.AuthInteraction;
  readonly options: typesModule.LoginOptions | undefined;
}

const login = (request: LoginRequest): Effect.Effect<typesModule.Credential> =>
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
    const loginOperation: Promise<typesModule.Credential> = loginMethod(
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
  readonly state: modelsStateTypes.ModelsState;
  readonly providerId: string;
  readonly options: typesModule.AuthOperationOptions | undefined;
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

const modelsAuthApply = {
  applyAuth,
  assertChatModel,
  authorize,
  login,
  logout,
  requireChatProvider,
  requireProvider,
  storeCredential,
};

export default modelsAuthApply;
