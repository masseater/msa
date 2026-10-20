import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { type ModelsStore } from "../src/models-store.ts";
import { createModels } from "../src/models.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { envKeyAuth, testModel, testProvider } = modelsRuntimeSupport;
const alwaysGivesProvidersAConcreteSignal = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const receivedSignal: { value: AbortSignal | undefined } = { value: undefined };
      const models = createModels();
      models.setProvider(
        testProvider({
          id: "dynamic",
          refreshModels: ({ signal }) => {
            receivedSignal.value = signal;

            return Promise.resolve();
          },
        }),
      );

      const result = yield* Effect.promise(() => models.refresh());
      expect(result.aborted).toBe(false);
      expect(receivedSignal.value).toBeInstanceOf(AbortSignal);
      expect(receivedSignal.value?.aborted).toBe(false);
    }),
  );

const bindsModelStoreWaitsToThe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const effectContext = yield* Effect.context();
      const storageSignals: (AbortSignal | undefined)[] = [];
      const store: ModelsStore = {
        delete: (_providerId, options) => {
          storageSignals.push(options?.signal);

          return Promise.resolve();
        },
        read: (_providerId, options) => {
          storageSignals.push(options?.signal);
          return Promise.resolve(undefined);
        },
        write: (_providerId, _entry, options) => {
          storageSignals.push(options?.signal);

          return Promise.resolve();
        },
      };
      const providerSignal: { value: AbortSignal | undefined } = { value: undefined };
      const models = createModels({ modelsStore: store });
      models.setProvider(
        testProvider({
          auth: { apiKey: envKeyAuth("key") },
          id: "dynamic",
          refreshModels: (refreshContext) =>
            Effect.runPromiseWith(effectContext)(
              Effect.gen(function* () {
                providerSignal.value = refreshContext.signal;
                if (!refreshContext.allowNetwork) return;
                yield* Effect.promise(() =>
                  refreshContext.publish({
                    persist: { models: [testModel("dynamic", "fresh")] },
                  }),
                );
              }),
            ),
        }),
      );

      const result = yield* Effect.promise(() => models.refresh({ providers: ["dynamic"] }));

      expect(result.errors.size).toBe(0);
      expect(storageSignals).toHaveLength(3);
      expect(storageSignals.every((signal) => signal === providerSignal.value)).toBe(true);
    }),
  );

const returnsAbortedStateWithoutReportingCancellation = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const models = createModels();
      models.setProvider(
        testProvider({
          id: "dynamic",
          refreshModels: ({ signal }) => {
            controller.abort();
            if (signal.aborted) return Promise.resolve();

            return Promise.resolve();
          },
        }),
      );

      const result = yield* Effect.promise(() => models.refresh({ signal: controller.signal }));
      expect(result.aborted).toBe(true);
      expect(result.errors.size).toBe(0);
    }),
  );
};

describe("Models runtime", () => {
  it("always gives providers a concrete signal", alwaysGivesProvidersAConcreteSignal);
});

describe("Models runtime", () => {
  it("binds model-store waits to the provider refresh signal", bindsModelStoreWaitsToThe);
});

describe("Models runtime", () => {
  it(
    "returns aborted state without reporting cancellation as a provider error",
    returnsAbortedStateWithoutReportingCancellation,
  );
});
