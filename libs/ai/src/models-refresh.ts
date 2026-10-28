import { Clock, Effect } from "effect";

import type typesModule from "./auth/types.ts";
import modelsKit from "./models-kit.ts";
import modelsShared from "./models-shared.ts";
import type modelsStateTypes from "./models-state.types.ts";
import type providerTypesModule from "./models/provider-types.ts";
import type typesModuleModule from "./models/types.ts";

const { readCredential, withKnownModelTypes } = modelsShared;
const { abort: abortModule, credentialStore, modelsError, resolve: resolveModule } = modelsKit;
const { runAfterPrevious } = credentialStore;
const { ModelsError } = modelsError;
const { refreshStoredOAuthCredential } = resolveModule;
const { abortable, operationSignal, raceWithAbortSignal } = abortModule;

type RefreshableProvider = providerTypesModule.Provider &
  Required<Pick<providerTypesModule.Provider, "refreshModels">>;

interface ProviderRefreshTarget {
  readonly state: modelsStateTypes.ModelsState;
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
  return { controller, generation };
};

interface ProviderRefreshRun {
  readonly state: modelsStateTypes.ModelsState;
  readonly provider: RefreshableProvider;
  readonly generation: number;
  readonly signal: AbortSignal;
}

const publishProviderModels = (
  run: ProviderRefreshRun,
  publication: providerTypesModule.ModelsPublication,
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
  readonly credential: typesModule.Credential | undefined;
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
        allowNetwork: phase.allowNetwork,
        baseUrl: provider.baseUrl,
        credential: phase.credential,
        force: phase.allowNetwork ? phase.force : undefined,
        publish: (publication) => publishProviderModels(run, publication),
        signal,
        stored: stored === undefined ? undefined : withKnownModelTypes(structuredClone(stored)),
      }),
    );
  });

const resolveRefreshCredential = (
  run: ProviderRefreshRun,
  stored: typesModule.Credential | undefined,
): Effect.Effect<typesModule.Credential | undefined> =>
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
      apiKey.resolve({ credential, ctx: state.authContext, signal }),
    );
    if (result === undefined) return undefined;
    return { env: result.env, key: result.auth.apiKey, type: "api_key" as const };
  });

const refreshProviderModels = (
  run: ProviderRefreshRun,
  options: typesModuleModule.ModelsRefreshOptions,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const read = yield* readCredential({
      providerId: run.provider.id,
      signal: run.signal,
      state: run.state,
    }).pipe(
      Effect.map((credential) => ({ credential, error: undefined as unknown })),
      Effect.catchDefect((error) => Effect.succeed({ credential: undefined, error })),
    );

    yield* runProviderRefreshPhase(run, {
      allowNetwork: false,
      credential: read.credential,
      force: undefined,
    });
    if (read.error !== undefined) return yield* Effect.die(read.error);
    if (options.allowNetwork === false || run.signal.aborted) return;

    const credential = yield* resolveRefreshCredential(run, read.credential);
    if (credential === undefined) return;
    yield* runProviderRefreshPhase(run, { allowNetwork: true, credential, force: options.force });
  });

interface ProviderRefreshRequest {
  readonly state: modelsStateTypes.ModelsState;
  readonly provider: RefreshableProvider;
  readonly callerSignal: AbortSignal;
  readonly options: typesModuleModule.ModelsRefreshOptions;
  readonly errors: Map<string, Error>;
}

const refreshProvider = (request: ProviderRefreshRequest): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { state, provider, errors } = request;
    const { generation, controller } = beginProviderRefresh({ providerId: provider.id, state });
    const signal = AbortSignal.any([request.callerSignal, controller.signal]);
    yield* abortable(
      refreshProviderModels({ generation, provider, signal, state }, request.options),
      signal,
    ).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => {
          if (signal.aborted) return;
          errors.set(
            provider.id,
            error instanceof Error
              ? error
              : ModelsError.create("model_source", `Model refresh failed for ${provider.id}`, {
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
  readonly state: modelsStateTypes.ModelsState;
  readonly options: typesModuleModule.ModelsRefreshOptions;
}

const refreshModels = ({
  state,
  options,
}: ModelsRefreshRequest): Effect.Effect<typesModuleModule.ModelsRefreshResult> =>
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
      (provider) => refreshProvider({ callerSignal, errors, options, provider, state }),
      { concurrency: "unbounded", discard: true },
    );
    yield* abortable(refresh, callerSignal).pipe(
      Effect.catchDefect((error) => (callerSignal.aborted ? Effect.void : Effect.die(error))),
    );

    return { aborted: callerSignal.aborted, errors: new Map(errors) };
  });

const modelsRefresh = {
  beginProviderRefresh,
  publishProviderModels,
  refreshModels,
  refreshProvider,
  refreshProviderModels,
  resolveRefreshCredential,
  runProviderRefreshPhase,
  supersedeProviderRefresh,
};

export default modelsRefresh;
