import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import eventBusModule from "../../../src/core/event-bus.ts";
import loader from "../../../src/core/extensions/loader.ts";
import type extensionsTypesTypes from "../../../src/core/extensions/types.types.ts";

const { createExtensionRuntime, loadExtensionFromFactory } = loader;
const { createEventBus } = eventBusModule;

const { gate } = testing;

const providerConfig = {
  apiKey: "provider-test-key",
  baseUrl: "https://provider.test/v1",
} satisfies extensionsTypesTypes.ProviderConfig;

const discardsRuntimeChangesAndDisablesThe = Effect.gen(function* () {
  const runtime = createExtensionRuntime(() => ({}));
  const eventBus = createEventBus();
  let capturedApi: extensionsTypesTypes.ExtensionAPI | undefined;
  let eventCalls = 0;
  let flagDuringLoad: boolean | string | undefined;

  yield* Effect.promise(() =>
    loadExtensionFromFactory(
      (msa) => msa.registerProvider("working-provider", providerConfig),
      process.cwd(),
      eventBus,
      runtime,
      "<working>",
    ),
  );
  yield* Effect.promise(() =>
    expect(
      loadExtensionFromFactory(
        (msa) => {
          capturedApi = msa;
          msa.events.on("factory-failure", () => {
            eventCalls++;
          });
          msa.registerFlag("failed-flag", { default: true, type: "boolean" });
          flagDuringLoad = msa.getFlag("failed-flag");
          msa.unregisterProvider("working-provider");
          msa.registerProvider("failed-provider", providerConfig);
          throw new Error("factory failed");
        },
        process.cwd(),
        eventBus,
        runtime,
        "<failing>",
      ),
    ).rejects.toThrow("factory failed"),
  );

  eventBus.emit("factory-failure", undefined);
  expect(flagDuringLoad).toBe(true);
  expect(runtime.flagValues.has("failed-flag")).toBe(false);
  expect(runtime.pendingProviderRegistrations.map(({ name }) => name)).toEqual([
    "working-provider",
  ]);
  expect(eventCalls).toBe(0);
  expect(capturedApi).toBeDefined();
  expect(() => capturedApi?.registerFlag("late-flag", { default: true, type: "boolean" })).toThrow(
    'Extension "<failing>" failed to load and its API is no longer active.',
  );
});

const doesNotDiscardAConcurrentlyLoaded = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const runtime = createExtensionRuntime(() => ({}));
  const eventBus = createEventBus();
  const waitBeforeFailure = gate();
  const failingLoad = loadExtensionFromFactory(
    (msa) =>
      runPromise(
        Effect.gen(function* () {
          msa.registerProvider("failed-provider", providerConfig);
          yield* Effect.promise(() => waitBeforeFailure);
          throw new Error("factory failed");
        }),
      ),
    process.cwd(),
    eventBus,
    runtime,
    "<failing>",
  );

  yield* Effect.promise(() =>
    loadExtensionFromFactory(
      (msa) => msa.registerProvider("working-provider", providerConfig),
      process.cwd(),
      eventBus,
      runtime,
      "<working>",
    ),
  );
  waitBeforeFailure.release();

  yield* Effect.promise(() => expect(failingLoad).rejects.toThrow("factory failed"));
  expect(runtime.pendingProviderRegistrations.map(({ name }) => name)).toEqual([
    "working-provider",
  ]);
});

const discardsRuntimeChangesAndDisablesTheFailed = () =>
  Effect.runPromise(discardsRuntimeChangesAndDisablesThe);

const doesNotDiscardAConcurrentlyLoadedFactory = () =>
  Effect.runPromise(doesNotDiscardAConcurrentlyLoaded);

describe("issue #8423 extension factory failure", () => {
  it(
    "discards runtime changes and disables the failed API",
    discardsRuntimeChangesAndDisablesTheFailed,
  );
  it(
    "does not discard a concurrently loaded factory's provider",
    doesNotDiscardAConcurrentlyLoadedFactory,
  );
});
