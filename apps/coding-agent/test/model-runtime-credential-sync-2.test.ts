import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import CredentialSynchronizationError from "../src/core/credential-synchronization-error.ts";
import ModelRuntime from "../src/core/model-runtime.ts";
import modelRuntimeCredentialSyncSupport from "./model-runtime-credential-sync-support.ts";
const { makeGate, providers, runtimes } = modelRuntimeCredentialSyncSupport;

const { abortController, awaited, runTest } = testing;

const doesNotRunNetworkRefreshInsideThe = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const networkRefresh = vi.fn(() => effectRunPromise(Effect.never));
  const runtime = yield* awaited(
    runtimes.withProvider(
      providers.create("local-only", {
        refreshModels: (context) =>
          effectRunPromise(
            Effect.gen(function* () {
              if (context.allowNetwork) return yield* awaited(networkRefresh());
            }),
          ),
      }),
    ),
  );

  yield* awaited(
    runtime.login("local-only", "api_key", {
      notify: () => {},
      prompt: () => effectRunPromise(awaited("unused")),
    }),
  );
  expect(networkRefresh).not.toHaveBeenCalled();
  expect(runtime.hasConfiguredAuth("local-only")).toBe(true);
});

const keepsProviderScopedRefreshesFromSupersedingUnrelated = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let firstSignal: AbortSignal | undefined;
  const started = makeGate();
  const blocked = makeGate();
  const runtime = yield* awaited(
    ModelRuntime.create({
      credentials: AuthStorage.inMemory(),
      modelsPath: null,
    }),
  );
  runtime.registerNativeProvider(
    providers.create("one", {
      refreshModels: (context) =>
        effectRunPromise(
          Effect.gen(function* () {
            if (context.allowNetwork === false) return;
            firstSignal = context.signal;
            started.open();
            yield* blocked.promise;
          }),
        ),
    }),
  );
  runtime.registerNativeProvider(providers.create("two"));
  yield* awaited(runtime.refresh({ allowNetwork: false, providers: ["one", "two"] }));
  yield* awaited(runtime.setRuntimeApiKey("one", "one-key"));
  yield* awaited(runtime.setRuntimeApiKey("two", "two-key"));

  const first = runtime.refresh({ allowNetwork: true, providers: ["one"] });
  yield* started.promise;
  yield* awaited(runtime.refresh({ allowNetwork: true, providers: ["two"] }));
  expect(firstSignal?.aborted).toBe(false);

  blocked.open();
  yield* awaited(first);
});

type Gate = ReturnType<typeof makeGate>;

const delayedCommitStore = (committed: Gate, mutationFinished: Gate) => {
  let stored: aiTypes.Credential | undefined;
  const credentials: aiTypes.CredentialStore = {
    delete: () => {
      stored = undefined;
      return Promise.resolve();
    },
    list: () =>
      Promise.resolve(
        stored === undefined ? [] : [{ providerId: "delayed-commit", type: stored.type }],
      ),
    modify: (_providerId, update) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const next = yield* awaited(update(stored));
          if (next !== undefined) stored = next;
          committed.open();
          yield* mutationFinished.promise;
          return stored;
        }),
      ),
    read: () => Promise.resolve(stored),
  };
  return { credentials, stored: () => stored };
};

const waitsForACommittedCredentialMutationTo = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const committed = makeGate();
  const mutationFinished = makeGate();
  const store = delayedCommitStore(committed, mutationFinished);
  const credentials = store.credentials;
  const runtime = yield* awaited(ModelRuntime.create({ credentials, modelsPath: null }));
  runtime.registerNativeProvider(providers.create("delayed-commit"));
  yield* awaited(runtime.refresh({ allowNetwork: false, providers: ["delayed-commit"] }));
  const controller = abortController();
  let settled = false;
  const login = runtime.login("delayed-commit", "api_key", {
    notify: () => {},
    prompt: () => effectRunPromise(awaited("unused")),
    signal: controller.signal,
  });
  const outcome = login.then(
    () => {
      settled = true;
      return undefined;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  yield* committed.promise;
  controller.abort();
  yield* Effect.sleep(0);
  expect(settled).toBe(false);

  mutationFinished.open();
  yield* awaited(
    expect(outcome).resolves.toMatchObject({
      credential: { key: "delayed-commit-key", type: "api_key" as const },
      name: "CredentialSynchronizationError",
    }),
  );
  expect(store.stored()).toEqual({ key: "delayed-commit-key", type: "api_key" as const });
});

const reportsATypedErrorWhenCancellationInterrupts = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let blockCacheRefresh = false;
  const cacheRefreshStarted = makeGate();
  const credentials = AuthStorage.inMemory();
  const runtime = yield* awaited(
    runtimes.withProvider(
      providers.create("cancelled-sync", {
        refreshModels: (context) =>
          effectRunPromise(
            Effect.gen(function* () {
              if (context.allowNetwork === false && blockCacheRefresh) {
                cacheRefreshStarted.open();
                return yield* Effect.never;
              }
            }),
          ),
      }),
      credentials,
    ),
  );
  blockCacheRefresh = true;
  const controller = abortController();
  const login = runtime.login("cancelled-sync", "api_key", {
    notify: () => {},
    prompt: () => effectRunPromise(awaited("unused")),
    signal: controller.signal,
  });
  yield* cacheRefreshStarted.promise;
  controller.abort();

  yield* awaited(
    expect(login).rejects.toMatchObject({
      credential: { key: "cancelled-sync-key", type: "api_key" as const },
      name: "CredentialSynchronizationError",
      operation: "login",
      providerId: "cancelled-sync",
    }),
  );
  expect(yield* awaited(credentials.read("cancelled-sync"))).toEqual({
    key: "cancelled-sync-key",
    type: "api_key" as const,
  });
});

const reportsCommittedCredentialsWhenLocalSynchronizationFails = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let failCacheRefresh = false;
  const credentials = AuthStorage.inMemory();
  const runtime = yield* awaited(
    runtimes.withProvider(
      providers.create("broken-sync", {
        refreshModels: (context) =>
          effectRunPromise(
            Effect.sync(() => {
              if (context.allowNetwork === false && failCacheRefresh)
                throw new Error("cache restore failed");
            }),
          ),
      }),
      credentials,
    ),
  );
  failCacheRefresh = true;

  const login = runtime.login("broken-sync", "api_key", {
    notify: () => {},
    prompt: () => effectRunPromise(awaited("unused")),
  });
  yield* awaited(
    expect(login).rejects.toMatchObject({
      credential: { key: "broken-sync-key", type: "api_key" as const },
      name: "CredentialSynchronizationError",
      operation: "login",
      providerId: "broken-sync",
    }),
  );
  yield* awaited(expect(login).rejects.toBeInstanceOf(CredentialSynchronizationError));
  expect(yield* awaited(credentials.read("broken-sync"))).toEqual({
    key: "broken-sync-key",
    type: "api_key" as const,
  });
});

describe("ModelRuntime credential synchronization", () => {
  it("does not run network refresh inside the credential operation chain", () =>
    runTest(doesNotRunNetworkRefreshInsideThe));

  it("keeps provider-scoped refreshes from superseding unrelated providers", () =>
    runTest(keepsProviderScopedRefreshesFromSupersedingUnrelated));

  it("waits for a committed credential mutation to settle before reporting cancellation", () =>
    runTest(waitsForACommittedCredentialMutationTo));

  it("reports a typed error when cancellation interrupts post-commit synchronization", () =>
    runTest(reportsATypedErrorWhenCancellationInterrupts));

  it("reports committed credentials when local synchronization fails", () =>
    runTest(reportsCommittedCredentialsWhenLocalSynchronizationFails));
});
