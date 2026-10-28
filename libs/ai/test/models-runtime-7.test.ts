import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import InMemoryModelsStore from "../src/models-store.ts";
import type modelsStoreTypes from "../src/models-store.types.ts";
import modelsModule from "../src/models.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { createModels } = modelsModule;

const { testModel, testProvider } = modelsRuntimeSupport;
const stopsWaitingOnAbortWhenA = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const effectContext = yield* Effect.context();

      const startedGate = Promise.withResolvers<void>();
      const started = startedGate.promise;
      const stalledGate = Promise.withResolvers<void>();
      const stalled = stalledGate.promise;
      const calls = { value: 0 };
      const models = createModels();
      models.setProvider(
        testProvider({
          id: "dynamic",
          refreshModels: () =>
            Effect.runPromiseWith(effectContext)(
              Effect.gen(function* () {
                calls.value++;
                if (calls.value !== 1) return;
                startedGate.resolve();
                yield* Effect.promise(() => stalled);
              }),
            ),
        }),
      );

      const pending = models.refresh({ signal: controller.signal });
      yield* Effect.promise(() => started);
      controller.abort();

      const result = yield* Effect.promise(() => pending);
      expect(result.aborted).toBe(true);
      expect(result.errors.size).toBe(0);

      stalledGate.reject(new Error("late provider failure"));
      yield* Effect.yieldNow;
      expect(result.errors.size).toBe(0);
    }),
  );
};

const generationalProvider = (store: modelsStoreTypes.InMemoryModelsStore) => {
  const state = { value: "initial" };
  const calls = { value: 0 };
  const firstStarted = Promise.withResolvers<void>();
  const firstBlocked = Promise.withResolvers<void>();
  const models = createModels({ modelsStore: store });
  models.setProvider(
    testProvider({
      id: "dynamic",
      refreshModels: (refreshContext) => {
        if (!refreshContext.allowNetwork) return Promise.resolve();
        calls.value++;
        const value = `generation-${calls.value}`;
        const ready = calls.value === 1 ? firstBlocked.promise : Promise.resolve();
        if (calls.value === 1) firstStarted.resolve();
        return ready
          .then(() =>
            refreshContext.publish({
              persist: { models: [testModel("dynamic", value)] },
              update: () => {
                state.value = value;
              },
            }),
          )
          .then(() => undefined);
      },
    }),
  );
  return { firstBlocked, firstStarted, models, state };
};

const rejectsLatePublicationFromASuperseded = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = new InMemoryModelsStore();
      const { firstBlocked, firstStarted, models, state } = generationalProvider(store);

      const first = models.refresh({ providers: ["dynamic"] });
      yield* Effect.promise(() => firstStarted.promise);
      yield* Effect.promise(() => models.refresh({ providers: ["dynamic"] }));
      yield* Effect.promise(() => first);
      firstBlocked.resolve();
      yield* Effect.yieldNow;

      expect(state.value).toBe("generation-2");
      const stored = yield* Effect.promise(() => store.read("dynamic"));
      expect(stored?.models[0]?.id).toBe("generation-2");
    }),
  );

describe("Models runtime", () => {
  it("stops waiting on abort when a provider ignores its signal", stopsWaitingOnAbortWhenA);
});

describe("Models runtime", () => {
  it(
    "rejects late publication from a superseded non-cooperative provider",
    rejectsLatePublicationFromASuperseded,
  );
});
