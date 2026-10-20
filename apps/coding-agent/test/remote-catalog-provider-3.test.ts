import { InMemoryModelsStore, createModels } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import remoteCatalogProviderSupport from "./remote-catalog-provider-support.ts";
import remoteCatalogProviderSupport2 from "./remote-catalog-provider-support2.ts";

const { testProvider } = remoteCatalogProviderSupport2;

const { model, refreshProvider } = remoteCatalogProviderSupport;

const { awaited, deferredPromise, runTest, toJsonText } = testing;

afterEach(() => vi.restoreAllMocks());

const dropsAStaleEtagWhenTheOverlay = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const responses = [
        new Response(yield* toJsonText({ dynamic: model("dynamic") }), {
          headers: { "content-type": "application/json", etag: '"catalog-1"' },
        }),
        new Response("not implemented", { status: 501 }),
      ];
      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        effectRunPromise(awaited(responses.shift() as Response)),
      );
      const provider = testProvider();
      const store = new InMemoryModelsStore();

      yield* awaited(refreshProvider(provider, store));
      yield* awaited(refreshProvider(provider, store, { force: true }));

      expect((yield* awaited(store.read(provider.id)))?.etag).toBeUndefined();
    }),
  );

const keepsTheEtagAndOverlayAfterA = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const responses = [
        new Response(yield* toJsonText({ dynamic: model("dynamic") }), {
          headers: { "content-type": "application/json", etag: '"catalog-1"' },
        }),
        new Response("rate limited", { status: 429 }),
        new Response("rate limited", { status: 429 }),
        new Response("rate limited", { status: 429 }),
        new Response(null, { headers: { etag: '"catalog-1"' }, status: 304 }),
      ];
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(() => effectRunPromise(awaited(responses.shift() as Response)));
      const provider = testProvider();
      const store = new InMemoryModelsStore();

      yield* awaited(refreshProvider(provider, store));
      yield* awaited(
        expect(refreshProvider(provider, store, { force: true })).rejects.toThrow(/429/u),
      );

      const stored = yield* awaited(store.read(provider.id));
      expect(stored?.etag).toBe('"catalog-1"');
      expect(stored?.models.map((entry) => entry.id)).toEqual(["dynamic"]);

      yield* awaited(refreshProvider(provider, store, { force: true }));
      expect(fetchSpy.mock.calls[4]?.[1]?.headers).toMatchObject({
        "if-none-match": '"catalog-1"',
      });
      expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "dynamic"]);
    }),
  );

const letsANewerCatalogRequestBypassA = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      let calls = 0;
      const firstStarted = deferredPromise<void>();
      const firstResponse = deferredPromise<Response>();
      const markFirstStarted = firstStarted.resolve;
      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        effectRunPromise(
          Effect.gen(function* () {
            calls++;
            if (calls === 1) {
              markFirstStarted?.();
              return yield* awaited(firstResponse.promise);
            }
            return yield* awaited(
              new Response(yield* toJsonText({ newer: model("newer") }), {
                headers: { "content-type": "application/json" },
              }),
            );
          }),
        ),
      );
      const provider = testProvider();
      const store = new InMemoryModelsStore();
      const models = createModels({ modelsStore: store });
      models.setProvider(provider);

      const first = models.refresh({ force: true, providers: [provider.id] });
      yield* awaited(firstStarted.promise);
      const second = models.refresh({ force: true, providers: [provider.id] });
      yield* awaited(second);
      yield* awaited(first);
      expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "newer"]);

      firstResponse.resolve(
        new Response(yield* toJsonText({ older: model("older") }), {
          headers: { "content-type": "application/json" },
        }),
      );
      yield* Effect.sleep(0);

      expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "newer"]);
      expect((yield* awaited(store.read(provider.id)))?.models.map((entry) => entry.id)).toEqual([
        "newer",
      ]);
    }),
  );

const treatsUnimplementedPiDevCatalogRoutesAs = () =>
  runTest(
    Effect.gen(function* () {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("not implemented", { status: 501 }),
      );
      const provider = testProvider();
      const store = new InMemoryModelsStore();

      yield* awaited(expect(refreshProvider(provider, store)).resolves.toBeUndefined());
      expect(provider.getModels().map((entry) => entry.id)).toEqual(["static"]);
      expect(yield* awaited(store.read(provider.id))).toMatchObject({
        checkedAt: expect.any(Number),
        models: [],
      });
    }),
  );

describe("remote catalog provider", () => {
  it("drops a stale etag when the overlay becomes unavailable", dropsAStaleEtagWhenTheOverlay);

  it("keeps the etag and overlay after a transient failure", keepsTheEtagAndOverlayAfterA);

  it(
    "lets a newer catalog request bypass a stalled older request without stale publication",
    letsANewerCatalogRequestBypassA,
  );

  it(
    "treats unimplemented pi.dev catalog routes as an unavailable overlay",
    treatsUnimplementedPiDevCatalogRoutesAs,
  );
});
