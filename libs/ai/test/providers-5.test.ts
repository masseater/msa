import { Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import InMemoryModelsStore from "../src/models-store.ts";
import type modelsStoreTypes from "../src/models-store.types.ts";
import modelsModule from "../src/models.ts";
import type modelsTypes from "../src/models.types.ts";
import fauxModule from "../src/providers/faux.ts";
import type typesModule from "../src/types.types.ts";
import providersSupport from "./providers-support.ts";

const { fauxAssistantMessage, fauxProvider } = fauxModule;
const { createModels, createProvider } = modelsModule;

const { context, recordingStreams, testModel } = providersSupport;

const streamsQueuedResponsesThroughAModels = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const faux = fauxProvider();
      const models = createModels();
      models.setProvider(faux.provider);
      faux.setResponses([fauxAssistantMessage("hello from faux")]);

      const model = models.getModels(faux.provider.id)[0];

      if (model === undefined) throw new Error("Expected a model");
      const result = yield* Effect.promise(() => models.completeSimple(model, context));
      expect(result.stopReason).toBe("stop");
      expect(result.content).toEqual([{ text: "hello from faux", type: "text" }]);
      expect(faux.state.callCount).toBe(1);
    }),
  );

const submitsPollsAndRedeemsDeferredResponses = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const faux = fauxProvider({ deferred: { pendingFetches: 1, pollAfterMs: 25 } });
      const models = createModels();
      models.setProvider(faux.provider);
      faux.setResponses([fauxAssistantMessage("ready")]);
      const model = faux.getModel();

      const submission = models.streamSimple(model, context, { deferred: { window: "1h" } });
      const eventTypes: string[] = [];
      yield* Stream.fromAsyncIterable(submission, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            eventTypes.push(event.type);
          }),
        ),
      );
      const deferred = yield* Effect.promise(() => submission.result());
      expect(eventTypes).toEqual(["start", "done"]);
      expect(deferred).toMatchObject({ content: [], stopReason: "deferred" });
      expect(deferred.deferred).toEqual({
        api: model.api,
        id: expect.any(String),
        modelId: model.id,
        pollAfterMs: 25,
        provider: model.provider,
      });
      const handle = deferred.deferred;
      if (handle === undefined) throw new Error("Faux response did not include a deferred handle");

      const pending = yield* Effect.promise(() => models.fetchDeferred(model, handle));
      expect(pending.stopReason).toBe("deferred");
      expect(pending.deferred).toEqual(handle);

      const ready = yield* Effect.promise(() => models.fetchDeferred(model, handle, { wait: 0 }));
      expect(ready.stopReason).toBe("stop");
      expect(ready.content).toEqual([{ text: "ready", type: "text" }]);
      expect(ready.usage.totalTokens).toBeGreaterThan(0);
      expect(faux.state).toMatchObject({ callCount: 1, deferredFetchCount: 2 });
    }),
  );

const expectOnlyLatestListing = (
  provider: modelsTypes.Provider<typesModule.Api>,
  store: modelsStoreTypes.InMemoryModelsStore,
) =>
  Effect.gen(function* () {
    expect(provider.getModels().map((model) => model.id)).toEqual(["listed-2"]);
    const stored = yield* Effect.promise(() => store.read("dynamic"));
    expect(stored?.models.map((model) => model.id)).toEqual(["listed-2"]);
  });

const producesAStreamErrorForA = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const provider = createProvider({
        api: { "api-a": recordingStreams("a", []) },
        auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
        id: "mixed",
        models: [testModel("api-a", "model-a")],
      });
      const result = yield* Effect.promise(() =>
        provider.streamSimple(testModel("api-ghost", "model-x"), context).result(),
      );
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("no API implementation");
    }),
  );

describe("createProvider", () => {
  it(
    "produces a stream error for a model whose api has no implementation",
    producesAStreamErrorForA,
  );
});

const letsANewerDynamicRefreshBypass = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const effectContext = yield* Effect.context();
      const fetches = { value: 0 };

      const firstStarted = Promise.withResolvers<void>();
      const firstBlocked = Promise.withResolvers<void>();
      const provider = createProvider({
        api: recordingStreams("a", []),
        auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
        fetchModels: () =>
          Effect.runPromiseWith(effectContext)(
            Effect.gen(function* () {
              fetches.value++;
              const current = fetches.value;
              if (current === 1) {
                firstStarted.resolve();
                yield* Effect.promise(() => firstBlocked.promise);
              }
              return [testModel("api-a", `listed-${current}`)];
            }),
          ),
        id: "dynamic",
        models: [],
      });

      const store = new InMemoryModelsStore();
      const models = createModels({ modelsStore: store });
      models.setProvider(provider);
      expect(provider.getModels()).toEqual([]);

      const first = models.refresh({ providers: ["dynamic"] });
      yield* Effect.promise(() => firstStarted.promise);
      const second = models.refresh({ providers: ["dynamic"] });
      yield* Effect.promise(() => expect(second).resolves.toMatchObject({ aborted: false }));
      yield* Effect.promise(() => expect(first).resolves.toMatchObject({ aborted: false }));
      expect(fetches.value).toBe(2);
      yield* expectOnlyLatestListing(provider, store);

      firstBlocked.resolve();
      yield* Effect.yieldNow;
      yield* expectOnlyLatestListing(provider, store);
    }),
  );

describe("createProvider", () => {
  it(
    "lets a newer dynamic refresh bypass and supersede older network work",
    letsANewerDynamicRefreshBypass,
  );
});

describe("fauxProvider", () => {
  it("streams queued responses through a Models collection", streamsQueuedResponsesThroughAModels);
});

describe("fauxProvider", () => {
  it("submits, polls, and redeems deferred responses", submitsPollsAndRedeemsDeferredResponses);
});
