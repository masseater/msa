import { Effect, Function } from "effect";

import type helpersTypes from "./helpers.types.ts";
import type typesModule from "./types.ts";

const promptUser: {
  (
    prompt: typesModule.AuthPrompt,
  ): (interaction: typesModule.ProviderAuthInteraction) => Effect.Effect<string>;
  (
    interaction: typesModule.ProviderAuthInteraction,
    prompt: typesModule.AuthPrompt,
  ): Effect.Effect<string>;
} = Function.dual(
  2,
  (
    interaction: typesModule.ProviderAuthInteraction,
    prompt: typesModule.AuthPrompt,
  ): Effect.Effect<string> => Effect.promise(() => interaction.prompt(prompt)),
);

const throwIfAborted = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.sync(() => signal.throwIfAborted());
const authEnv =
  ({ ctx, signal }: helpersTypes.AuthEnvSource) =>
  (name: string): Effect.Effect<string | undefined> =>
    throwIfAborted(signal).pipe(
      Effect.andThen(Effect.promise(() => ctx.env(name))),
      Effect.tap(throwIfAborted(signal)),
    );

const envApiKeyAuth: {
  (envVars: readonly string[]): (name: string) => typesModule.ApiKeyAuth;
  (name: string, envVars: readonly string[]): typesModule.ApiKeyAuth;
} = Function.dual(2, (name: string, envVars: readonly string[]): typesModule.ApiKeyAuth => ({
  login: (interaction) =>
    Effect.runPromise(
      Effect.gen(function* () {
        interaction.signal.throwIfAborted();
        const key = yield* Effect.promise(() =>
          interaction.prompt({ message: `Enter ${name}`, type: "secret" }),
        );
        interaction.signal.throwIfAborted();
        return { key, type: "api_key" as const };
      }),
    ),
  name,
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

const lazyOAuth = (input: {
  name: string;
  isSubscription?: boolean;
  loginLabel?: string;
  load: () => Promise<typesModule.OAuthAuth>;
}): typesModule.OAuthAuth => {
  let promise: Promise<typesModule.OAuthAuth> | undefined;
  const loaded = () => {
    promise ??= input.load();
    return promise;
  };
  const withLoaded = <T>(use: (auth: typesModule.OAuthAuth) => Promise<T>): Promise<T> =>
    Effect.runPromise(
      Effect.promise(() => loaded()).pipe(
        Effect.flatMap((auth) => Effect.promise(() => use(auth))),
      ),
    );
  return {
    isSubscription: input.isSubscription,
    login: (interaction, options) => withLoaded((auth) => auth.login(interaction, options)),
    loginLabel: input.loginLabel,
    name: input.name,
    refresh: (credential, signal) => withLoaded((auth) => auth.refresh(credential, signal)),
    toAuth: (credential) => withLoaded((auth) => auth.toAuth(credential)),
  };
};

const helpers = {
  authEnv,
  envApiKeyAuth,
  lazyOAuth,
  promptUser,
  throwIfAborted,
};

export default helpers;
