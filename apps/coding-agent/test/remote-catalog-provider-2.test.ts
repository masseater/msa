import { type ImageModel, InMemoryModelsStore } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type PersonalizeCatalog,
  withPersonalizedCatalog,
} from "../src/core/remote-catalog-provider.ts";
import remoteCatalogProviderSupport from "./remote-catalog-provider-support.ts";

const { builtinProvider, model, refreshProvider } = remoteCatalogProviderSupport;

const { awaited, runTest } = testing;

afterEach(() => vi.restoreAllMocks());

const imageModel: ImageModel<"openrouter-images"> = {
  api: "openrouter-images" as const,
  baseUrl: "https://example.test/v1",
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "image",
  input: ["text"],
  name: "image",
  output: ["image"],
  provider: "test-provider",
  type: "image" as const,
};

const keepsTheSavedListAndSavesNothing = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));
      const store = new InMemoryModelsStore();
      const saved = { checkedAt: 1, models: [model("allowed")] };
      yield* awaited(store.write("test-provider", saved));
      const personalize: PersonalizeCatalog = () =>
        effectRunPromise(
          Effect.sync(() => {
            throw new Error("user models request failed");
          }),
        );
      const provider = withPersonalizedCatalog(builtinProvider(), personalize);

      yield* awaited(
        expect(refreshProvider(provider, store)).rejects.toThrow("user models request failed"),
      );
      expect(provider.getModels().map((entry) => entry.id)).toEqual(["allowed"]);
      expect(yield* awaited(store.read(provider.id))).toEqual(saved);
    }),
  );

const restoresASavedListAsIsAnd = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const personalize: PersonalizeCatalog = () =>
        effectRunPromise(
          Effect.sync(() => {
            throw new Error("not used offline");
          }),
        );
      const store = new InMemoryModelsStore();
      const provider = withPersonalizedCatalog(builtinProvider(), personalize);

      yield* awaited(store.write(provider.id, { checkedAt: 1, models: [] }));
      yield* awaited(refreshProvider(provider, store, { allowNetwork: false }));
      expect(provider.getModels().map((entry) => entry.id)).toEqual(["static"]);

      yield* awaited(store.write(provider.id, { checkedAt: 1, models: [imageModel] }));
      yield* awaited(refreshProvider(provider, store, { allowNetwork: false }));
      expect(provider.getModels()).toEqual([]);
      expect(provider.getAllModels?.().map((entry) => entry.id)).toEqual(["image"]);
    }),
  );

describe("personalized catalog provider", () => {
  it(
    "keeps the saved list and saves nothing when personalization fails",
    keepsTheSavedListAndSavesNothing,
  );

  it(
    "restores a saved list as is, and falls back to the built-in models only when it is empty",
    restoresASavedListAsIsAnd,
  );
});
