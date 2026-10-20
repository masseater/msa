import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { VERSION } from "../src/config.ts";
import { REMOTE_CATALOG_MODEL_TYPES } from "../src/core/remote-catalog-provider.ts";
import remoteCatalogProviderSupport from "./remote-catalog-provider-support.ts";
import remoteCatalogProviderSupport2 from "./remote-catalog-provider-support2.ts";

const { InMemoryModelsStore, createModels } = ai;

const { testProvider } = remoteCatalogProviderSupport2;

const { model, refreshProvider } = remoteCatalogProviderSupport;

const { awaited, dateFromMillis, runTest, toJsonText } = testing;

afterEach(() => vi.restoreAllMocks());

const parsesKeyedCatalogsSendsVersionHeadersObserves = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        effectRunPromise(
          awaited(
            new Response(JSON.stringify({ dynamic: model("dynamic") }), {
              headers: { "content-type": "application/json" },
              status: 200,
            }),
          ),
        ),
      );
      const provider = testProvider();
      const store = new InMemoryModelsStore();
      yield* awaited(refreshProvider(provider, store));
      yield* awaited(refreshProvider(provider, store));
      yield* awaited(refreshProvider(provider, store, { force: true }));

      expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "dynamic"]);
      expect((yield* awaited(store.read(provider.id)))?.models.map((entry) => entry.id)).toEqual([
        "dynamic",
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0]?.[1]?.headers).toMatchObject({
        "User-Agent": expect.stringContaining(`pi/${VERSION}`),
      });
      const requested = new URL(String(fetchSpy.mock.calls[0]?.[0]));
      expect(requested.pathname).toBe("/api/models/providers/test-provider");
      expect(requested.searchParams.get("types")).toBe(REMOTE_CATALOG_MODEL_TYPES.join(","));
    }),
  );

const overlaysImageAndClassifierModelsAndDropsPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      effectRunPromise(
        awaited(
          new Response(
            JSON.stringify({
              chat: { ...model("chat"), type: "chat" as const },
              clip: { ...model("clip"), type: "video" as const },
              flux: {
                api: "openrouter-images" as const,
                baseUrl: "https://example.test/v1",
                cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
                id: "flux",
                input: ["text"],
                name: "FLUX",
                output: ["image"],
                provider: "test-provider",
                type: "image" as const,
              },
              jev: {
                api: "typesafe-system-one" as const,
                baseUrl: "https://example.test/v1",
                contextWindow: 64000,
                cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
                id: "jev",
                input: ["text"],
                name: "Jev",
                provider: "test-provider",
                type: "classifier" as const,
              },
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          ),
        ),
      ),
    );
  });

const overlaysImageAndClassifierModelsAndDrops = () =>
  runTest(
    Effect.gen(function* () {
      yield* overlaysImageAndClassifierModelsAndDropsPart1();
      const provider = testProvider();
      const store = new InMemoryModelsStore();
      yield* awaited(refreshProvider(provider, store));

      const models = createModels({ modelsStore: store });
      models.setProvider(provider);
      expect(models.getAllModels("test-provider").map((entry) => entry.id)).toEqual([
        "static",
        "chat",
        "flux",
        "jev",
      ]);
      expect(models.getModelOfType("image", "test-provider", "flux")?.type).toBe("image");
      expect(models.getModelOfType("classifier", "test-provider", "jev")?.type).toBe("classifier");
      expect(models.getModel("test-provider", "flux")).toBeUndefined();
      const stored = yield* awaited(store.read(provider.id));
      expect(stored?.models.map((entry) => entry.id)).toEqual(["chat", "flux", "jev"]);
    }),
  );

const prefersTheNewerOfTheGeneratedAnd = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const localGeneratedAt = Date.parse("2026-07-23T10:00:00.000Z");
      const newerHeader = dateFromMillis(localGeneratedAt + 60_000).toUTCString();
      const responses = [
        new Response(yield* toJsonText({ old: model("old") }), {
          headers: { "last-modified": dateFromMillis(localGeneratedAt - 60_000).toUTCString() },
        }),
        new Response(yield* toJsonText({ newer: model("newer") }), {
          headers: { "last-modified": newerHeader },
        }),
      ];
      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        effectRunPromise(awaited(responses.shift() as Response)),
      );
      const provider = testProvider(localGeneratedAt);
      const store = new InMemoryModelsStore();

      yield* awaited(refreshProvider(provider, store));
      expect(provider.getModels().map((entry) => entry.id)).toEqual(["static"]);

      yield* awaited(refreshProvider(provider, store, { force: true }));
      expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "newer"]);
      expect(yield* awaited(store.read(provider.id))).toMatchObject({
        lastModified: Date.parse(newerHeader),
      });
    }),
  );

const revalidatesAStoredCatalogWithItsEtag = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const responses = [
        new Response(yield* toJsonText({ dynamic: model("dynamic") }), {
          headers: { "content-type": "application/json", etag: '"catalog-1"' },
        }),
        new Response(null, { headers: { etag: '"catalog-1"' }, status: 304 }),
      ];
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(() => effectRunPromise(awaited(responses.shift() as Response)));
      const provider = testProvider();
      const store = new InMemoryModelsStore();

      yield* awaited(refreshProvider(provider, store));
      expect(fetchSpy.mock.calls[0]?.[1]?.headers).not.toHaveProperty("if-none-match");
      expect(yield* awaited(store.read(provider.id))).toMatchObject({ etag: '"catalog-1"' });

      const checkedAt = (yield* awaited(store.read(provider.id)))?.checkedAt;
      yield* awaited(refreshProvider(provider, store, { force: true }));

      expect(fetchSpy.mock.calls[1]?.[1]?.headers).toMatchObject({
        "if-none-match": '"catalog-1"',
      });
      expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "dynamic"]);
      const stored = yield* awaited(store.read(provider.id));
      expect(stored?.models.map((entry) => entry.id)).toEqual(["dynamic"]);
      expect(stored?.etag).toBe('"catalog-1"');
      expect(stored?.checkedAt).toBeGreaterThanOrEqual(checkedAt ?? 0);
    }),
  );

describe("remote catalog provider", () => {
  it(
    "parses keyed catalogs, sends version headers, observes the refresh TTL, and supports forced refreshes",
    parsesKeyedCatalogsSendsVersionHeadersObserves,
  );

  it(
    "overlays image and classifier models and drops unknown model types",
    overlaysImageAndClassifierModelsAndDrops,
  );

  it("prefers the newer of the generated and remote catalogs", prefersTheNewerOfTheGeneratedAnd);

  it(
    "revalidates a stored catalog with its etag and keeps the overlay on 304",
    revalidatesAStoredCatalogWithItsEtag,
  );
});
