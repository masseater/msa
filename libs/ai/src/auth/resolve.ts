import { Clock, Effect, Function } from "effect";

import type { ProviderEnv } from "../types.ts";
import { abortable, operationSignal } from "../utils/abort.ts";
import { ModelsError, promiseOrModelsError } from "../utils/models-error.ts";

export { ModelsError, type ModelsErrorCode } from "../utils/models-error.ts";

import type {
  ApiKeyAuth,
  ApiKeyCredential,
  AuthContext,
  AuthResult,
  Credential,
  CredentialStore,
  OAuthAuth,
  OAuthCredential,
  ProviderAuth,
} from "./types.ts";

export interface AuthResolutionOverrides {
  apiKey?: string | undefined;
  env?: ProviderEnv | undefined;
  minOAuthValidityMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

interface AuthProvider {
  id: string;
  auth: ProviderAuth;
}

const overlayEnvAuthContext = (base: AuthContext, env: ProviderEnv): AuthContext => ({
  env: (name) => {
    const value = env[name];
    return value === undefined || value === "" ? base.env(name) : Promise.resolve(value);
  },
  fileExists: (path) => base.fileExists(path),
});

const DEFAULT_OAUTH_MINIMUM_VALIDITY_MS = 5 * 60 * 1000;
const DEFAULT_OAUTH_REFRESH_TIMEOUT_MS = 15_000;

interface RefreshRequest {
  readonly credentials: CredentialStore;
  readonly providerId: string;
  readonly oauth: OAuthAuth;
  readonly needsRefresh: (credential: OAuthCredential) => boolean;
  readonly signal: AbortSignal;
}

const refreshInsideLock = (
  request: RefreshRequest,
  current: Credential | undefined,
  cancelLockWait: () => void,
): Effect.Effect<OAuthCredential | undefined> =>
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

const refreshWithLock = (request: RefreshRequest): Effect.Effect<OAuthCredential | undefined> => {
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

export const refreshStoredOAuthCredential: {
  (
    providerId: string,
    oauth: OAuthAuth,
    needsRefresh: (credential: OAuthCredential) => boolean,
    signal: AbortSignal,
  ): (credentials: CredentialStore) => Effect.Effect<OAuthCredential | undefined>;
  (
    credentials: CredentialStore,
    providerId: string,
    oauth: OAuthAuth,
    needsRefresh: (credential: OAuthCredential) => boolean,
    signal: AbortSignal,
  ): Effect.Effect<OAuthCredential | undefined>;
} = Function.dual(
  5,
  (
    credentials: CredentialStore,
    providerId: string,
    oauth: OAuthAuth,
    needsRefresh: (credential: OAuthCredential) => boolean,
    signal: AbortSignal,
  ): Effect.Effect<OAuthCredential | undefined> =>
    refreshWithLock({ credentials, providerId, oauth, needsRefresh, signal }),
);

interface StoredOAuthRequest {
  readonly credentials: CredentialStore;
  readonly providerId: string;
  readonly oauth: OAuthAuth;
  readonly stored: OAuthCredential;
  readonly signal: AbortSignal;
  readonly minOAuthValidityMs: number | undefined;
}

const resolveStoredOAuth = (request: StoredOAuthRequest): Effect.Effect<AuthResult | undefined> =>
  Effect.gen(function* () {
    const { providerId, minOAuthValidityMs } = request;
    const clock = yield* Clock.Clock;
    const minimumValidityMs = Math.max(DEFAULT_OAUTH_MINIMUM_VALIDITY_MS, minOAuthValidityMs ?? 0);
    const expiresSoon = (credential: OAuthCredential) =>
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
  authContext: AuthContext,
  apiKey: ApiKeyAuth,
  providerId: string,
  credential: ApiKeyCredential | undefined,
  signal: AbortSignal,
): Effect.Effect<AuthResult | undefined> =>
  promiseOrModelsError(() => apiKey.resolve({ ctx: authContext, credential, signal }), {
    code: "auth",
    message: `API key auth failed for provider ${providerId}`,
  });

const resolveStoredCredential = (
  provider: AuthProvider,
  credentials: CredentialStore,
  requestAuthContext: AuthContext,
  overrides: AuthResolutionOverrides | undefined,
  signal: AbortSignal,
) =>
  Effect.fn("resolveStoredCredential")(function* (stored: Credential) {
    if (stored.type === "oauth" && provider.auth.oauth !== undefined) {
      return yield* resolveStoredOAuth({
        credentials,
        providerId: provider.id,
        oauth: provider.auth.oauth,
        stored,
        signal,
        minOAuthValidityMs: overrides?.minOAuthValidityMs,
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
  provider: AuthProvider,
  credentials: CredentialStore,
  authContext: AuthContext,
  overrides: AuthResolutionOverrides | undefined,
  signal: AbortSignal,
): Effect.Effect<AuthResult | undefined> =>
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
        { type: "api_key", key: overrides.apiKey, env: overrides.env },
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

const isAuthProvider = (value: unknown): value is AuthProvider =>
  typeof value === "object" && value !== null && "id" in value && "auth" in value;

export const resolveProviderAuth: {
  (
    credentials: CredentialStore,
    authContext: AuthContext,
    overrides?: AuthResolutionOverrides,
  ): (provider: AuthProvider) => Effect.Effect<AuthResult | undefined>;
  (
    provider: AuthProvider,
    credentials: CredentialStore,
    authContext: AuthContext,
    overrides?: AuthResolutionOverrides,
  ): Effect.Effect<AuthResult | undefined>;
} = Function.dual(
  (args) => isAuthProvider(args[0]),
  (
    provider: AuthProvider,
    credentials: CredentialStore,
    authContext: AuthContext,
    overrides?: AuthResolutionOverrides,
  ): Effect.Effect<AuthResult | undefined> => {
    const signal = operationSignal(overrides?.signal);
    return abortable(
      resolveProviderAuthWithSignal(provider, credentials, authContext, overrides, signal),
      signal,
    );
  },
);
