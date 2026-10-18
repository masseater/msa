import type { ApiKeyCredential, Credential, CredentialStore, Model, Provider } from "@msa/ai";
import { awaited, runTest, abortController } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { CredentialSynchronizationError, ModelRuntime } from "../src/core/model-runtime.ts";

function model(provider: string): Model<"openai-completions"> {
  return {
    id: "dynamic",
    name: "Dynamic",
    api: "openai-completions" as const,
    provider,
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

function provider(
  id: string,
  options: {
    login?: () => Promise<ApiKeyCredential>;
    refreshModels?: Provider["refreshModels"];
  } = {},
): Provider<"openai-completions"> {
  const providerModel = model(id);
  return {
    id,
    name: id,
    auth: {
      apiKey: {
        name: "API key",
        login: () =>
          runTest(awaited(options.login?.() ?? { type: "api_key" as const, key: `${id}-key` })),
        check: ({ credential }) =>
          runTest(awaited(credential ? { type: "api_key" as const, source: "stored" } : undefined)),
        resolve: ({ credential }) =>
          runTest(
            awaited(
              credential ? { auth: { apiKey: credential.key }, source: "stored" } : undefined,
            ),
          ),
      },
    },
    getModels: () => [providerModel],
    ...(options.refreshModels === undefined ? {} : { refreshModels: options.refreshModels }),
    stream: () => {
      throw new Error("unused");
    },
    streamSimple: () => {
      throw new Error("unused");
    },
  };
}

function runtimeWithProvider(
  registered: Provider,
  credentials: AuthStorage = AuthStorage.inMemory(),
): Promise<ModelRuntime> {
  return runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({
          credentials,
          modelsPath: null,
          allowModelNetwork: false,
        }),
      );
      runtime.registerNativeProvider(registered);
      yield* awaited(runtime.refresh({ allowNetwork: false, providers: [registered.id] }));
      return yield* awaited(runtime);
    }),
  );
}

describe("ModelRuntime credential synchronization", () => {
  it("publishes locally consistent availability before login and logout resolve", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const credentials = AuthStorage.inMemory();
        const runtime = yield* awaited(runtimeWithProvider(provider("dynamic"), credentials));

        yield* awaited(
          runtime.login("dynamic", "api_key", {
            prompt: () => effectRunPromise(awaited("unused")),
            notify: () => {},
          }),
        );
        expect(runtime.hasConfiguredAuth("dynamic")).toBe(true);
        expect(runtime.getAvailableSnapshot().map((entry) => entry.id)).toContain("dynamic");
        expect(yield* awaited(credentials.read("dynamic"))).toEqual({
          type: "api_key" as const,
          key: "dynamic-key",
        });

        yield* awaited(runtime.logout("dynamic"));
        expect(runtime.hasConfiguredAuth("dynamic")).toBe(false);
        expect(runtime.getAvailableSnapshot().some((entry) => entry.provider === "dynamic")).toBe(
          false,
        );
        expect(yield* awaited(credentials.read("dynamic"))).toBeUndefined();
      }),
    ));

  it("orders same-provider credential operations through local synchronization", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let markLoginStarted: (() => void) | undefined;
        let finishLogin: (() => void) | undefined;
        const loginStarted = new Promise<void>((resolve) => {
          markLoginStarted = resolve;
        });
        const blockedLogin = new Promise<void>((resolve) => {
          finishLogin = resolve;
        });
        const credentials = AuthStorage.inMemory();
        const runtime = yield* awaited(
          runtimeWithProvider(
            provider("ordered", {
              login: () =>
                effectRunPromise(
                  Effect.gen(function* () {
                    markLoginStarted?.();
                    yield* awaited(blockedLogin);
                    return yield* awaited({ type: "api_key" as const, key: "ordered-key" });
                  }),
                ),
            }),
            credentials,
          ),
        );

        const login = runtime.login("ordered", "api_key", {
          prompt: () => effectRunPromise(awaited("unused")),
          notify: () => {},
        });
        yield* awaited(loginStarted);
        const logout = runtime.logout("ordered");
        yield* Effect.sleep(0);
        expect(yield* awaited(credentials.read("ordered"))).toBeUndefined();

        finishLogin?.();
        yield* awaited(Promise.all([login, logout]));
        expect(yield* awaited(credentials.read("ordered"))).toBeUndefined();
        expect(runtime.hasConfiguredAuth("ordered")).toBe(false);
      }),
    ));

  it("allows different providers to run credential flows concurrently", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let firstStarted: (() => void) | undefined;
        let secondStarted: (() => void) | undefined;
        let finish: (() => void) | undefined;
        const first = new Promise<void>((resolve) => {
          firstStarted = resolve;
        });
        const second = new Promise<void>((resolve) => {
          secondStarted = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        runtime.registerNativeProvider(
          provider("one", {
            login: () =>
              effectRunPromise(
                Effect.gen(function* () {
                  firstStarted?.();
                  yield* awaited(blocked);
                  return yield* awaited({ type: "api_key" as const, key: "one" });
                }),
              ),
          }),
        );
        runtime.registerNativeProvider(
          provider("two", {
            login: () =>
              effectRunPromise(
                Effect.gen(function* () {
                  secondStarted?.();
                  yield* awaited(blocked);
                  return yield* awaited({ type: "api_key" as const, key: "two" });
                }),
              ),
          }),
        );
        yield* awaited(runtime.refresh({ allowNetwork: false, providers: ["one", "two"] }));

        const one = runtime.login("one", "api_key", {
          prompt: () => effectRunPromise(awaited("unused")),
          notify: () => {},
        });
        const two = runtime.login("two", "api_key", {
          prompt: () => effectRunPromise(awaited("unused")),
          notify: () => {},
        });
        yield* awaited(Promise.all([first, second]));
        finish?.();
        yield* awaited(Promise.all([one, two]));
      }),
    ));

  it("does not wait for unrelated provider availability during local synchronization", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let stallUnrelated = false;
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        runtime.registerNativeProvider(provider("target"));
        const unrelated = provider("unrelated");
        if (unrelated.auth.apiKey) {
          unrelated.auth.apiKey.check = () =>
            effectRunPromise(
              Effect.gen(function* () {
                if (stallUnrelated) yield* awaited(new Promise<void>(() => {}));
                return yield* awaited(undefined);
              }),
            );
        }
        runtime.registerNativeProvider(unrelated);
        yield* awaited(
          runtime.refresh({ allowNetwork: false, providers: ["target", "unrelated"] }),
        );
        stallUnrelated = true;

        yield* awaited(
          runtime.login("target", "api_key", {
            prompt: () => effectRunPromise(awaited("unused")),
            notify: () => {},
          }),
        );
        expect(runtime.hasConfiguredAuth("target")).toBe(true);
        yield* awaited(
          expect(
            runtime.refresh({ allowNetwork: false, providers: ["target"] }),
          ).resolves.toMatchObject({
            aborted: false,
          }),
        );
      }),
    ));

  it("reports cancellation that occurs during provider-scoped availability", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let blockAvailability = false;
        let markStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const registered = provider("cancelled-availability");
        if (registered.auth.apiKey) {
          registered.auth.apiKey.check = ({ credential }) =>
            effectRunPromise(
              Effect.gen(function* () {
                if (blockAvailability) {
                  markStarted?.();
                  yield* awaited(new Promise<void>(() => {}));
                }
                return yield* awaited(
                  credential ? { type: "api_key" as const, source: "stored" } : undefined,
                );
              }),
            );
        }
        const runtime = yield* awaited(runtimeWithProvider(registered));
        yield* awaited(runtime.setRuntimeApiKey(registered.id, "key"));
        blockAvailability = true;
        const controller = abortController();
        const refresh = runtime.refresh({
          allowNetwork: false,
          providers: [registered.id],
          signal: controller.signal,
        });
        yield* awaited(started);
        controller.abort();

        yield* awaited(expect(refresh).resolves.toMatchObject({ aborted: true }));
      }),
    ));

  it("does not run network refresh inside the credential operation chain", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const networkRefresh = vi.fn(() => effectRunPromise(awaited(new Promise<void>(() => {}))));
        const runtime = yield* awaited(
          runtimeWithProvider(
            provider("local-only", {
              refreshModels: (context) =>
                effectRunPromise(
                  Effect.gen(function* () {
                    if (context.allowNetwork) yield* awaited(networkRefresh());
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

        let markStarted: (() => void) | undefined;
        let finish: (() => void) | undefined;
        let firstSignal: AbortSignal | undefined;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        runtime.registerNativeProvider(
          provider("one", {
            refreshModels: (context) =>
              effectRunPromise(
                Effect.gen(function* () {
                  if (!context.allowNetwork) return;
                  firstSignal = context.signal;
                  markStarted?.();
                  yield* awaited(blocked);
                }),
              ),
          }),
        );
        runtime.registerNativeProvider(provider("two"));
        yield* awaited(runtime.refresh({ allowNetwork: false, providers: ["one", "two"] }));
        yield* awaited(runtime.setRuntimeApiKey("one", "one-key"));
        yield* awaited(runtime.setRuntimeApiKey("two", "two-key"));

        const first = runtime.refresh({ allowNetwork: true, providers: ["one"] });
        yield* awaited(started);
        yield* awaited(runtime.refresh({ allowNetwork: true, providers: ["two"] }));
        expect(firstSignal?.aborted).toBe(false);

        finish?.();
        yield* awaited(first);
      }),
    ));

  it("waits for a committed credential mutation to settle before reporting cancellation", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let stored: Credential | undefined;
        let markCommitted: (() => void) | undefined;
        let finishMutation: (() => void) | undefined;
        const committed = new Promise<void>((resolve) => {
          markCommitted = resolve;
        });
        const mutationFinished = new Promise<void>((resolve) => {
          finishMutation = resolve;
        });
        const credentials: CredentialStore = {
          read: () => effectRunPromise(awaited(stored)),
          list: () =>
            effectRunPromise(
              awaited(stored ? [{ providerId: "delayed-commit", type: stored.type }] : []),
            ),
          modify: (_providerId, update) =>
            effectRunPromise(
              Effect.gen(function* () {
                const next = yield* awaited(update(stored));
                if (next) stored = next;
                markCommitted?.();
                yield* awaited(mutationFinished);
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
        runtime.registerNativeProvider(provider("delayed-commit"));
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
        yield* awaited(committed);
        controller.abort();
        yield* Effect.sleep(0);
        expect(settled).toBe(false);

        finishMutation?.();
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
        let markCacheRefreshStarted: (() => void) | undefined;
        const cacheRefreshStarted = new Promise<void>((resolve) => {
          markCacheRefreshStarted = resolve;
        });
        const credentials = AuthStorage.inMemory();
        const runtime = yield* awaited(
          runtimeWithProvider(
            provider("cancelled-sync", {
              refreshModels: (context) =>
                effectRunPromise(
                  Effect.gen(function* () {
                    if (!context.allowNetwork && blockCacheRefresh) {
                      markCacheRefreshStarted?.();
                      yield* awaited(new Promise<void>(() => {}));
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
        yield* awaited(cacheRefreshStarted);
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
          runtimeWithProvider(
            provider("broken-sync", {
              refreshModels: (context) =>
                effectRunPromise(
                  Effect.sync(() => {
                    if (!context.allowNetwork && failCacheRefresh)
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
