import { abortController, awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { makeGate, providers, runtimes } from "./model-runtime-credential-sync-support.ts";

describe("ModelRuntime credential synchronization", () => {
  it("publishes locally consistent availability before login and logout resolve", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const credentials = AuthStorage.inMemory();
        const runtime = yield* awaited(
          runtimes.withProvider(providers.create("dynamic"), credentials),
        );

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
        const loginStarted = makeGate();
        const blockedLogin = makeGate();
        const credentials = AuthStorage.inMemory();
        const runtime = yield* awaited(
          runtimes.withProvider(
            providers.create("ordered", {
              login: () =>
                effectRunPromise(
                  Effect.gen(function* () {
                    loginStarted.open();
                    yield* blockedLogin.promise;
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
        yield* loginStarted.promise;
        const logout = runtime.logout("ordered");
        yield* Effect.sleep(0);
        expect(yield* awaited(credentials.read("ordered"))).toBeUndefined();

        blockedLogin.open();
        yield* awaited(Promise.all([login, logout]));
        expect(yield* awaited(credentials.read("ordered"))).toBeUndefined();
        expect(runtime.hasConfiguredAuth("ordered")).toBe(false);
      }),
    ));

  it("allows different providers to run credential flows concurrently", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());
        const first = makeGate();
        const second = makeGate();
        const blocked = makeGate();
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        runtime.registerNativeProvider(
          providers.create("one", {
            login: () =>
              effectRunPromise(
                Effect.gen(function* () {
                  first.open();
                  yield* blocked.promise;
                  return yield* awaited({ type: "api_key" as const, key: "one" });
                }),
              ),
          }),
        );
        runtime.registerNativeProvider(
          providers.create("two", {
            login: () =>
              effectRunPromise(
                Effect.gen(function* () {
                  second.open();
                  yield* blocked.promise;
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
        yield* Effect.all([first.promise, second.promise]);
        blocked.open();
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
        runtime.registerNativeProvider(providers.create("target"));
        const unrelated = providers.create("unrelated");
        if (unrelated.auth.apiKey !== undefined) {
          unrelated.auth.apiKey.check = () =>
            effectRunPromise(
              Effect.gen(function* () {
                if (stallUnrelated) return yield* Effect.never;
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
        const started = makeGate();
        const registered = providers.create("cancelled-availability");
        if (registered.auth.apiKey !== undefined) {
          registered.auth.apiKey.check = ({ credential }) =>
            effectRunPromise(
              Effect.gen(function* () {
                if (blockAvailability) {
                  started.open();
                  return yield* Effect.never;
                }
                return yield* awaited(
                  credential === undefined
                    ? undefined
                    : { type: "api_key" as const, source: "stored" },
                );
              }),
            );
        }
        const runtime = yield* awaited(runtimes.withProvider(registered));
        yield* awaited(runtime.setRuntimeApiKey(registered.id, "key"));
        blockAvailability = true;
        const controller = abortController();
        const refresh = runtime.refresh({
          allowNetwork: false,
          providers: [registered.id],
          signal: controller.signal,
        });
        yield* started.promise;
        controller.abort();

        yield* awaited(expect(refresh).resolves.toMatchObject({ aborted: true }));
      }),
    ));
});
