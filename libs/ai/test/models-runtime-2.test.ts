import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import modelsModule from "../src/models.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { createModels } = modelsModule;

const { testModel, testProvider } = modelsRuntimeSupport;
const keepsChatReadsIndependentFromThe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const provider = testProvider({ id: "chat-only" });
      provider.getAllModels = () => {
        throw new Error("all models unavailable");
      };
      const models = createModels();
      models.setProvider(provider);

      expect(models.getModels("chat-only").map((model) => model.id)).toEqual(["model-a"]);
      expect(models.getModel("chat-only", "model-a")?.id).toBe("model-a");
      expect(
        (yield* Effect.promise(() => models.getAvailable("chat-only"))).map((model) => model.id),
      ).toEqual(["model-a"]);
      expect(models.getAllModels("chat-only")).toEqual([]);
    }),
  );

const swallowsProviderSourceFailuresForBoth = () => {
  const models = createModels();
  models.setProvider(
    testProvider({
      getModels: () => {
        throw new Error("boom");
      },
      id: "broken",
    }),
  );
  models.setProvider(testProvider({ id: "ok", models: [testModel("ok", "m1")] }));

  expect(models.getModels().map((m) => m.id)).toEqual(["m1"]);
  expect(models.getModels("broken")).toEqual([]);
  expect(() => models.getProvider("broken")?.getModels()).toThrow("boom");
};

const refreshUpdatesEveryConfiguredDynamicProvider = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const list = { value: [testModel("dyn", "before")] };
      const refreshes = { value: 0 };
      const models = createModels();
      models.setProvider(
        testProvider({
          getModels: () => list.value,
          id: "dyn",
          refreshModels: (refresh) => {
            if (!refresh.allowNetwork) return Promise.resolve();
            refreshes.value++;
            return refresh
              .publish({
                update: () => {
                  list.value = [testModel("dyn", "after")];
                },
              })
              .then(() => undefined);
          },
        }),
      );
      models.setProvider(testProvider({ id: "static", models: [testModel("static", "s1")] }));

      expect(models.getModel("dyn", "before")).toBeDefined();
      const first = yield* Effect.promise(() => models.refresh());
      expect(first.errors.size).toBe(0);
      expect(refreshes.value).toBe(1);
      expect(models.getModel("dyn", "after")).toBeDefined();
      expect(models.getModel("dyn", "before")).toBeUndefined();

      models.setProvider(
        testProvider({
          id: "flaky",
          refreshModels: ({ allowNetwork }) => {
            if (allowNetwork) return Promise.reject(new Error("fetch failed"));

            return Promise.resolve();
          },
        }),
      );
      const second = yield* Effect.promise(() => models.refresh());
      expect(refreshes.value).toBe(2);
      expect(second.errors.get("flaky")?.message).toBe("fetch failed");
    }),
  );

const restrictsRefreshWorkToSelectedProviders = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = [];
      const models = createModels();
      for (const id of ["one", "two"]) {
        models.setProvider(
          testProvider({
            id,
            refreshModels: ({ allowNetwork }) => {
              calls.push(`${id}:${allowNetwork ? "network" : "cache"}`);

              return Promise.resolve();
            },
          }),
        );
      }

      const result = yield* Effect.promise(() => models.refresh({ providers: ["two", "unknown"] }));

      expect(result.errors.size).toBe(0);
      expect(calls).toEqual(["two:cache", "two:network"]);
    }),
  );

describe("Models runtime", () => {
  it("keeps chat reads independent from the all-model catalog", keepsChatReadsIndependentFromThe);

  it(
    "swallows provider source failures for both all-provider and single-provider listing",
    swallowsProviderSourceFailuresForBoth,
  );
});

describe("Models runtime", () => {
  it(
    "refresh() updates every configured dynamic provider and reports failures",
    refreshUpdatesEveryConfiguredDynamicProvider,
  );
});

describe("Models runtime", () => {
  it("restricts refresh work to selected providers", restrictsRefreshWorkToSelectedProviders);
});
