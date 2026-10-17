import { Effect, Function } from "effect";

import type { ApiKeyAuth, OAuthAuth } from "./types.ts";

export const envApiKeyAuth: {
  (envVars: readonly string[]): (name: string) => ApiKeyAuth;
  (name: string, envVars: readonly string[]): ApiKeyAuth;
} = Function.dual(2, (name: string, envVars: readonly string[]): ApiKeyAuth => ({
  name,
  login: (interaction) =>
    Effect.runPromise(
      Effect.gen(function* () {
        interaction.signal.throwIfAborted();
        const key = yield* Effect.promise(() =>
          interaction.prompt({ type: "secret", message: `Enter ${name}` }),
        );
        interaction.signal.throwIfAborted();
        return { type: "api_key" as const, key };
      }),
    ),
  resolve: ({ ctx, credential, signal }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        signal.throwIfAborted();
        if (credential?.key !== undefined && credential?.key !== "") {
          return {
            auth: { apiKey: credential.key },
            env: credential.env,
            source: "stored credential",
          };
        }
        for (const envVar of envVars) {
          const value = yield* Effect.promise(() => ctx.env(envVar));
          signal.throwIfAborted();
          if (value !== undefined && value !== "")
            return { auth: { apiKey: value }, source: envVar };
        }
        return undefined;
      }),
    ),
}));

export const lazyOAuth = (input: {
  name: string;
  isSubscription?: boolean;
  loginLabel?: string;
  load: () => Promise<OAuthAuth>;
}): OAuthAuth => {
  let promise: Promise<OAuthAuth> | undefined;
  const loaded = () => {
    promise ??= input.load();
    return promise;
  };
  const withLoaded = <T>(use: (auth: OAuthAuth) => Promise<T>): Promise<T> =>
    Effect.runPromise(
      Effect.promise(() => loaded()).pipe(
        Effect.flatMap((auth) => Effect.promise(() => use(auth))),
      ),
    );
  return {
    name: input.name,
    isSubscription: input.isSubscription,
    loginLabel: input.loginLabel,
    login: (interaction, options) => withLoaded((auth) => auth.login(interaction, options)),
    refresh: (credential, signal) => withLoaded((auth) => auth.refresh(credential, signal)),
    toAuth: (credential) => withLoaded((auth) => auth.toAuth(credential)),
  };
};
