import type { Credential, CredentialStore } from "@msa/ai";
import { abortController, awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { CredentialSynchronizationError, ModelRuntime } from "../src/core/model-runtime.ts";
import { makeGate, providers, runtimes } from "./model-runtime-credential-sync-support.ts";

describe("ModelRuntime credential synchronization", () => {
  it("does not run network refresh inside the credential operation chain", () =>
    runTest(
      Effect.gen(function* () {
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
            prompt: () => effectRunPromise(awaited("unused")),
            notify: () => {},
          }),
        );
        expect(networkRefresh).not.toHaveBeenCalled();
        expect(runtime.hasConfiguredAuth("local-only")).toBe(true);
      }),
    ));

  it("keeps provider-scoped refreshes from superseding unrelated providers", () =>
    runTest(
      Effect.gen(function* () {
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
      }),
    ));

  it("waits for a committed credential mutation to settle before reporting cancellation", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let stored: Credential | undefined;
        const committed = makeGate();
        const mutationFinished = makeGate();
        const credentials: CredentialStore = {
          read: () => effectRunPromise(awaited(stored)),
          list: () =>
            effectRunPromise(
              awaited(
                stored === undefined ? [] : [{ providerId: "delayed-commit", type: stored.type }],
              ),
            ),
          modify: (_providerId, update) =>
            effectRunPromise(
              Effect.gen(function* () {
                const next = yield* awaited(update(stored));
                if (next !== undefined) stored = next;
                committed.open();
                yield* mutationFinished.promise;
                return yield* awaited(stored);
              }),
            ),
          delete: () =>
            effectRunPromise(
              Effect.sync(() => {
                stored = undefined;
              }),
            ),
        };
        const runtime = yield* awaited(ModelRuntime.create({ credentials, modelsPath: null }));
        runtime.registerNativeProvider(providers.create("delayed-commit"));
        yield* awaited(runtime.refresh({ allowNetwork: false, providers: ["delayed-commit"] }));
        const controller = abortController();
        let settled = false;
        const login = runtime.login("delayed-commit", "api_key", {
          signal: controller.signal,
          prompt: () => effectRunPromise(awaited("unused")),
          notify: () => {},
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
            name: "CredentialSynchronizationError",
            credential: { type: "api_key" as const, key: "delayed-commit-key" },
          }),
        );
        expect(stored).toEqual({ type: "api_key" as const, key: "delayed-commit-key" });
      }),
    ));

  it("reports a typed error when cancellation interrupts post-commit synchronization", () =>
    runTest(
      Effect.gen(function* () {
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
          signal: controller.signal,
          prompt: () => effectRunPromise(awaited("unused")),
          notify: () => {},
        });
        yield* cacheRefreshStarted.promise;
        controller.abort();

        yield* awaited(
          expect(login).rejects.toMatchObject({
            name: "CredentialSynchronizationError",
            providerId: "cancelled-sync",
            operation: "login",
            credential: { type: "api_key" as const, key: "cancelled-sync-key" },
          }),
        );
        expect(yield* awaited(credentials.read("cancelled-sync"))).toEqual({
          type: "api_key" as const,
          key: "cancelled-sync-key",
        });
      }),
    ));

  it("reports committed credentials when local synchronization fails", () =>
    runTest(
      Effect.gen(function* () {
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
          prompt: () => effectRunPromise(awaited("unused")),
          notify: () => {},
        });
        yield* awaited(
          expect(login).rejects.toMatchObject({
            name: "CredentialSynchronizationError",
            providerId: "broken-sync",
            operation: "login",
            credential: { type: "api_key" as const, key: "broken-sync-key" },
          }),
        );
        yield* awaited(expect(login).rejects.toBeInstanceOf(CredentialSynchronizationError));
        expect(yield* awaited(credentials.read("broken-sync"))).toEqual({
          type: "api_key" as const,
          key: "broken-sync-key",
        });
      }),
    ));
});
