import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  InMemoryModelsStore,
  type ModelsStore,
  type ModelsStoreEntry,
} from "../src/models-store.ts";
import { createModels, createProvider } from "../src/models.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { testModel, testProvider } = modelsRuntimeSupport;
const restoresCachedModelsBeforeWaitingFor = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const effectContext = yield* Effect.context();
      const store = new InMemoryModelsStore();
      yield* Effect.promise(() =>
        store.write("dynamic", { models: [testModel("dynamic", "cached")] }),
      );

      const authStartedGate = Promise.withResolvers<void>();
      const authStarted = authStartedGate.promise;
      const blockedAuthGate = Promise.withResolvers<void>();
      const blockedAuth = blockedAuthGate.promise;
      const provider = createProvider({
        api: {
          stream: () => new AssistantMessageEventStream(),
          streamSimple: () => new AssistantMessageEventStream(),
        },
        auth: {
          apiKey: {
            name: "Blocked auth",
            resolve: () =>
              Effect.runPromiseWith(effectContext)(
                Effect.gen(function* () {
                  authStartedGate.resolve();
                  yield* Effect.promise(() => blockedAuth);
                  return { auth: { apiKey: "key" } };
                }),
              ),
          },
        },
        fetchModels: () => Promise.reject(new Error("must not fetch")),
        id: "dynamic",
        models: [],
      });
      const models = createModels({ modelsStore: store });
      models.setProvider(provider);
      const pending = models.refresh({ providers: ["dynamic"], signal: controller.signal });
      yield* Effect.promise(() => authStarted);

      expect(models.getModel("dynamic", "cached")).toBeDefined();
      controller.abort();
      expect(yield* Effect.promise(() => pending)).toMatchObject({ aborted: true });
      blockedAuthGate.resolve();
    }),
  );
};

const singleEntryStore = (entry: { value: ModelsStoreEntry | undefined }): ModelsStore => ({
  delete: () => {
    entry.value = undefined;
    return Promise.resolve();
  },
  read: () => Promise.resolve(entry.value),
  write: (_providerId, next) => {
    entry.value = next;
    return Promise.resolve();
  },
});

const choosesPersistentDeletionAndEphemeralPublication = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const entry: { value: ModelsStoreEntry | undefined } = {
        value: { models: [testModel("dynamic", "stored")] },
      };
      const state = { value: "initial" };
      const models = createModels({ modelsStore: singleEntryStore(entry) });
      models.setProvider(
        testProvider({
          id: "dynamic",
          refreshModels: (refreshContext) => {
            expect(refreshContext.stored?.models[0]?.id).toBe("stored");
            const deleteStored = refreshContext.publish({
              persist: null,
              update: () => {
                expect(entry.value).toBeUndefined();
                state.value = "deleted";
              },
            });
            const publishEphemeral = () =>
              refreshContext.publish({
                update: () => {
                  state.value = "ephemeral";
                },
              });
            return deleteStored.then(publishEphemeral).then(() => undefined);
          },
        }),
      );

      const result = yield* Effect.promise(() => models.refresh({ allowNetwork: false }));
      expect(result.errors.size).toBe(0);
      expect(entry.value).toBeUndefined();
      expect(state.value).toBe("ephemeral");
    }),
  );

describe("Models runtime", () => {
  it(
    "restores cached models before waiting for network auth",
    restoresCachedModelsBeforeWaitingFor,
  );
});

describe("Models runtime", () => {
  it(
    "lets providers choose persistent deletion and ephemeral publication atomically",
    choosesPersistentDeletionAndEphemeralPublication,
  );
});
