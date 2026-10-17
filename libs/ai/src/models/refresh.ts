import { Clock, Effect } from "effect";

import { refreshStoredOAuthCredential } from "../auth/resolve.ts";
import type { Credential } from "../auth/types.ts";
import { abortable, operationSignal, raceWithAbortSignal } from "../utils/abort.ts";
import { ModelsError } from "../utils/models-error.ts";
import { runAfterPrevious } from "../utils/serial-chain.ts";
import type { ModelsPublication, Provider } from "./provider-types.ts";
import { type ModelsState, readCredential, withKnownModelTypes } from "./state.ts";
import type { ModelsRefreshOptions, ModelsRefreshResult } from "./types.ts";

type RefreshableProvider = Provider & Required<Pick<Provider, "refreshModels">>;

export interface ProviderRefreshTarget {
  readonly state: ModelsState;
  readonly providerId: string;
}

export const supersedeProviderRefresh = ({ state, providerId }: ProviderRefreshTarget): number => {
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

export interface ModelsRefreshRequest {
  readonly state: ModelsState;
  readonly options: ModelsRefreshOptions;
}

export const refreshModels = ({
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
