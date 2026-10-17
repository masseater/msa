import { Deferred, Effect, Exit } from "effect";

import type {
  AuthInteraction,
  AuthOperationOptions,
  AuthType,
  Credential,
  LoginOptions,
} from "../auth/types.ts";
import { abortable, operationSignal, waitForAbort } from "../utils/abort.ts";
import { ModelsError } from "../utils/models-error.ts";
import type { ModelsState } from "./state.ts";

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

export interface LoginRequest {
  readonly state: ModelsState;
  readonly providerId: string;
  readonly type: AuthType;
  readonly interaction: AuthInteraction;
  readonly options: LoginOptions | undefined;
}

export const login = (request: LoginRequest): Effect.Effect<Credential> =>
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

export interface LogoutRequest {
  readonly state: ModelsState;
  readonly providerId: string;
  readonly options: AuthOperationOptions | undefined;
}

export const logout = ({ state, providerId, options }: LogoutRequest): Effect.Effect<void> =>
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
