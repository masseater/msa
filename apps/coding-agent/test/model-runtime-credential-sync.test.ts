import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import modelRuntimeCredentialSyncSupport from "./model-runtime-credential-sync-support.ts";

const { makeGate, providers, runtimes } = modelRuntimeCredentialSyncSupport;

const { abortController, awaited, runTest } = testing;

const publishesLocallyConsistentAvailabilityBeforeLoginAnd = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const credentials = AuthStorage.inMemory();
  const runtime = yield* awaited(runtimes.withProvider(providers.create("dynamic"), credentials));

  yield* awaited(
    runtime.login("dynamic", "api_key", {
      notify: () => {},
      prompt: () => effectRunPromise(awaited("unused")),
    }),
  );
  expect(runtime.hasConfiguredAuth("dynamic")).toBe(true);
  expect(runtime.getAvailableSnapshot().map((entry) => entry.id)).toContain("dynamic");
  expect(yield* awaited(credentials.read("dynamic"))).toEqual({
    key: "dynamic-key",
    type: "api_key" as const,
  });

  yield* awaited(runtime.logout("dynamic"));
  expect(runtime.hasConfiguredAuth("dynamic")).toBe(false);
  expect(runtime.getAvailableSnapshot().some((entry) => entry.provider === "dynamic")).toBe(false);
  expect(yield* awaited(credentials.read("dynamic"))).toBeUndefined();
});

const ordersSameProviderCredentialOperationsThroughLocal = Effect.gen(function* () {
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
              return yield* awaited({ key: "ordered-key", type: "api_key" as const });
            }),
          ),
      }),
      credentials,
    ),
  );

  const login = runtime.login("ordered", "api_key", {
    notify: () => {},
    prompt: () => effectRunPromise(awaited("unused")),
  });
  yield* loginStarted.promise;
  const logout = runtime.logout("ordered");
  yield* Effect.sleep(0);
  expect(yield* awaited(credentials.read("ordered"))).toBeUndefined();

  blockedLogin.open();
  yield* awaited(Promise.all([login, logout]));
  expect(yield* awaited(credentials.read("ordered"))).toBeUndefined();
  expect(runtime.hasConfiguredAuth("ordered")).toBe(false);
});

const allowsDifferentProvidersToRunCredentialFlows = Effect.gen(function* () {
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
            return yield* awaited({ key: "one", type: "api_key" as const });
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
            return yield* awaited({ key: "two", type: "api_key" as const });
          }),
        ),
    }),
  );
  yield* awaited(runtime.refresh({ allowNetwork: false, providers: ["one", "two"] }));

  const one = runtime.login("one", "api_key", {
    notify: () => {},
    prompt: () => effectRunPromise(awaited("unused")),
  });
  const two = runtime.login("two", "api_key", {
    notify: () => {},
    prompt: () => effectRunPromise(awaited("unused")),
  });
  yield* Effect.all([first.promise, second.promise]);
  blocked.open();
  yield* awaited(Promise.all([one, two]));
});

const doesNotWaitForUnrelatedProviderAvailability = Effect.gen(function* () {
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
  yield* awaited(runtime.refresh({ allowNetwork: false, providers: ["target", "unrelated"] }));
  stallUnrelated = true;

  yield* awaited(
    runtime.login("target", "api_key", {
      notify: () => {},
      prompt: () => effectRunPromise(awaited("unused")),
    }),
  );
  expect(runtime.hasConfiguredAuth("target")).toBe(true);
  yield* awaited(
    expect(runtime.refresh({ allowNetwork: false, providers: ["target"] })).resolves.toMatchObject({
      aborted: false,
    }),
  );
});

const reportsCancellationThatOccursDuringProviderScoped = Effect.gen(function* () {
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
            credential === undefined ? undefined : { source: "stored", type: "api_key" as const },
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
});

describe("ModelRuntime credential synchronization", () => {
  it("publishes locally consistent availability before login and logout resolve", () =>
    runTest(publishesLocallyConsistentAvailabilityBeforeLoginAnd));

  it("orders same-provider credential operations through local synchronization", () =>
    runTest(ordersSameProviderCredentialOperationsThroughLocal));

  it("allows different providers to run credential flows concurrently", () =>
    runTest(allowsDifferentProvidersToRunCredentialFlows));

  it("does not wait for unrelated provider availability during local synchronization", () =>
    runTest(doesNotWaitForUnrelatedProviderAvailability));

  it("reports cancellation that occurs during provider-scoped availability", () =>
    runTest(reportsCancellationThatOccursDuringProviderScoped));
});
