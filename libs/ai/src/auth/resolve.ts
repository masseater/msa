import { Clock, Effect, Function } from "effect";

import type typesModule from "../types.types.ts";
import abortModule from "../utils/abort.ts";
import modelsError from "../utils/models-error.ts";
import type resolveTypes from "./resolve.types.ts";
import type typesModuleModule from "./types.ts";

const { ModelsError, promiseOrModelsError } = modelsError;
const { abortable, operationSignal } = abortModule;
const overlayEnvAuthContext = (
  base: typesModuleModule.AuthContext,
  env: typesModule.ProviderEnv,
): typesModuleModule.AuthContext => ({
  env: (name) => {
    const value = env[name];
    return value === undefined || value === "" ? base.env(name) : Promise.resolve(value);
  },
  fileExists: (path) => base.fileExists(path),
});

const DEFAULT_OAUTH_MINIMUM_VALIDITY_MS = 5 * 60 * 1000;
const DEFAULT_OAUTH_REFRESH_TIMEOUT_MS = 15_000;

interface RefreshRequest {
  readonly credentials: typesModuleModule.CredentialStore;
  readonly providerId: string;
  readonly oauth: typesModuleModule.OAuthAuth;
  readonly needsRefresh: (credential: typesModuleModule.OAuthCredential) => boolean;
  readonly signal: AbortSignal;
}

const refreshInsideLock = (
  request: RefreshRequest,
  current: typesModuleModule.Credential | undefined,
  cancelLockWait: () => void,
): Effect.Effect<typesModuleModule.OAuthCredential | undefined> =>
  Effect.gen(function* () {
    request.signal.removeEventListener("abort", cancelLockWait);
    request.signal.throwIfAborted();
    if (current?.type !== "oauth") return undefined;
    if (!request.needsRefresh(current)) return undefined;
    return yield* promiseOrModelsError(
      () => request.oauth.refresh(current, AbortSignal.timeout(DEFAULT_OAUTH_REFRESH_TIMEOUT_MS)),
      { code: "oauth", message: `OAuth refresh failed for ${request.providerId}` },
    );
  });

const refreshWithLock = (
  request: RefreshRequest,
): Effect.Effect<typesModuleModule.OAuthCredential | undefined> => {
  const { signal } = request;
  const lockWait = new AbortController();
  const cancelLockWait = () => lockWait.abort(signal.reason);
  return Effect.gen(function* () {
    const runInLock = Effect.runPromiseWith(yield* Effect.context<never>());
    signal.addEventListener("abort", cancelLockWait, { once: true });
    if (signal.aborted) cancelLockWait();
    const post = yield* Effect.promise(() =>
      request.credentials.modify(
        request.providerId,
        (current) => runInLock(refreshInsideLock(request, current, cancelLockWait)),
        { signal: lockWait.signal },
      ),
    ).pipe(
      Effect.catchDefect((error) =>
        error instanceof ModelsError
          ? Effect.die(error)
          : Effect.sync(() => signal.throwIfAborted()).pipe(
              Effect.andThen(
                Effect.die(
                  new ModelsError(
                    "auth",
                    `Credential store modify failed for ${request.providerId}`,
                    { cause: error },
                  ),
                ),
              ),
            ),
      ),
      Effect.ensuring(Effect.sync(() => signal.removeEventListener("abort", cancelLockWait))),
    );
    return post?.type === "oauth" ? post : undefined;
  });
};

const refreshStoredOAuthCredential: {
  (
    providerId: string,
    oauth: typesModuleModule.OAuthAuth,
    needsRefresh: (credential: typesModuleModule.OAuthCredential) => boolean,
    signal: AbortSignal,
  ): (
    credentials: typesModuleModule.CredentialStore,
  ) => Effect.Effect<typesModuleModule.OAuthCredential | undefined>;
  (
    credentials: typesModuleModule.CredentialStore,
    providerId: string,
    oauth: typesModuleModule.OAuthAuth,
    needsRefresh: (credential: typesModuleModule.OAuthCredential) => boolean,
    signal: AbortSignal,
  ): Effect.Effect<typesModuleModule.OAuthCredential | undefined>;
} = Function.dual(
  5,
  (
    credentials: typesModuleModule.CredentialStore,
    providerId: string,
    oauth: typesModuleModule.OAuthAuth,
    needsRefresh: (credential: typesModuleModule.OAuthCredential) => boolean,
    signal: AbortSignal,
  ): Effect.Effect<typesModuleModule.OAuthCredential | undefined> =>
    refreshWithLock({ credentials, needsRefresh, oauth, providerId, signal }),
);

interface StoredOAuthRequest {
  readonly credentials: typesModuleModule.CredentialStore;
  readonly providerId: string;
  readonly oauth: typesModuleModule.OAuthAuth;
  readonly stored: typesModuleModule.OAuthCredential;
  readonly signal: AbortSignal;
  readonly minOAuthValidityMs: number | undefined;
}

const resolveStoredOAuth = (
  request: StoredOAuthRequest,
): Effect.Effect<typesModuleModule.AuthResult | undefined> =>
  Effect.gen(function* () {
    const { providerId, minOAuthValidityMs } = request;
    const clock = yield* Clock.Clock;
    const minimumValidityMs = Math.max(DEFAULT_OAUTH_MINIMUM_VALIDITY_MS, minOAuthValidityMs ?? 0);
    const expiresSoon = (credential: typesModuleModule.OAuthCredential) =>
      clock.currentTimeMillisUnsafe() + minimumValidityMs >= credential.expires;
    let credential = request.stored;

    if (expiresSoon(credential)) {
      const post = yield* refreshWithLock({ ...request, needsRefresh: expiresSoon });
      if (post === undefined) return undefined;
      credential = post;
      if (minOAuthValidityMs !== undefined && expiresSoon(credential)) {
        return yield* Effect.die(
          new ModelsError(
            "oauth",
            `OAuth refresh returned a token that expires too soon for ${providerId}`,
          ),
        );
      }
    }

    const resolved = credential;
    const auth = yield* promiseOrModelsError(() => request.oauth.toAuth(resolved), {
      code: "oauth",
      message: `OAuth auth derivation failed for ${providerId}`,
    });
    return { auth, source: "OAuth" };
  });

const resolveApiKey = (
  authContext: typesModuleModule.AuthContext,
  apiKey: typesModuleModule.ApiKeyAuth,
  providerId: string,
  credential: typesModuleModule.ApiKeyCredential | undefined,
  signal: AbortSignal,
): Effect.Effect<typesModuleModule.AuthResult | undefined> =>
  promiseOrModelsError(() => apiKey.resolve({ credential, ctx: authContext, signal }), {
    code: "auth",
    message: `API key auth failed for provider ${providerId}`,
  });

const resolveStoredCredential = (
  provider: resolveTypes.AuthProvider,
  credentials: typesModuleModule.CredentialStore,
  requestAuthContext: typesModuleModule.AuthContext,
  overrides: resolveTypes.AuthResolutionOverrides | undefined,
  signal: AbortSignal,
) =>
  Effect.fn("resolveStoredCredential")(function* (stored: typesModuleModule.Credential) {
    if (stored.type === "oauth" && provider.auth.oauth !== undefined) {
      return yield* resolveStoredOAuth({
        credentials,
        minOAuthValidityMs: overrides?.minOAuthValidityMs,
        oauth: provider.auth.oauth,
        providerId: provider.id,
        signal,
        stored,
      });
    }
    if (stored.type === "api_key" && provider.auth.apiKey !== undefined) {
      const credential =
        overrides?.env === undefined
          ? stored
          : { ...stored, env: { ...stored.env, ...overrides.env } };
      return yield* resolveApiKey(
        requestAuthContext,
        provider.auth.apiKey,
        provider.id,
        credential,
        signal,
      );
    }
    return undefined;
  });

const resolveProviderAuthWithSignal = (
  provider: resolveTypes.AuthProvider,
  credentials: typesModuleModule.CredentialStore,
  authContext: typesModuleModule.AuthContext,
  overrides: resolveTypes.AuthResolutionOverrides | undefined,
  signal: AbortSignal,
): Effect.Effect<typesModuleModule.AuthResult | undefined> =>
  Effect.gen(function* () {
    signal.throwIfAborted();
    const requestAuthContext =
      overrides?.env === undefined
        ? authContext
        : overlayEnvAuthContext(authContext, overrides.env);

    if (overrides?.apiKey !== undefined && provider.auth.apiKey !== undefined) {
      return yield* resolveApiKey(
        requestAuthContext,
        provider.auth.apiKey,
        provider.id,
        { env: overrides.env, key: overrides.apiKey, type: "api_key" },
        signal,
      );
    }

    const stored = yield* promiseOrModelsError(() => credentials.read(provider.id, { signal }), {
      code: "auth",
      message: `Credential store read failed for ${provider.id}`,
    });
    if (stored !== undefined) {
      return yield* resolveStoredCredential(
        provider,
        credentials,
        requestAuthContext,
        overrides,
        signal,
      )(stored);
    }

    return provider.auth.apiKey === undefined
      ? undefined
      : yield* resolveApiKey(
          requestAuthContext,
          provider.auth.apiKey,
          provider.id,
          undefined,
          signal,
        );
  });

const isAuthProvider = (value: unknown): value is resolveTypes.AuthProvider =>
  typeof value === "object" && value !== null && "id" in value && "auth" in value;

const resolveProviderAuth: {
  (
    credentials: typesModuleModule.CredentialStore,
    authContext: typesModuleModule.AuthContext,
    overrides?: resolveTypes.AuthResolutionOverrides,
  ): (
    provider: resolveTypes.AuthProvider,
  ) => Effect.Effect<typesModuleModule.AuthResult | undefined>;
  (
    provider: resolveTypes.AuthProvider,
    credentials: typesModuleModule.CredentialStore,
    authContext: typesModuleModule.AuthContext,
    overrides?: resolveTypes.AuthResolutionOverrides,
  ): Effect.Effect<typesModuleModule.AuthResult | undefined>;
} = Function.dual(
  (args) => isAuthProvider(args[0]),
  (
    provider: resolveTypes.AuthProvider,
    credentials: typesModuleModule.CredentialStore,
    authContext: typesModuleModule.AuthContext,
    overrides?: resolveTypes.AuthResolutionOverrides,
  ): Effect.Effect<typesModuleModule.AuthResult | undefined> => {
    const signal = operationSignal(overrides?.signal);
    return abortable(
      resolveProviderAuthWithSignal(provider, credentials, authContext, overrides, signal),
      signal,
    );
  },
);

const resolveModule = {
  ModelsError: modelsError.ModelsError,
  refreshStoredOAuthCredential,
  resolveProviderAuth,
};

export default resolveModule;
