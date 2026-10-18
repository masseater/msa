import {
  createModels,
  createProvider,
  type ImageModel,
  InMemoryModelsStore,
  type Model,
  type ModelsPublication,
  type Provider,
  type RefreshModelsContext,
} from "@msa/ai";
import { awaited, runTest, abortController, toJsonText, dateFromMillis } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { VERSION } from "../src/config.ts";
import {
  type PersonalizeCatalog,
  REMOTE_CATALOG_MODEL_TYPES,
  withPersonalizedCatalog,
  withRemoteCatalog,
} from "../src/core/remote-catalog-provider.ts";

const neverAbortedSignal = abortController().signal;

function model(id: string): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions" as const,
    provider: "test-provider",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

function builtinProvider(): Provider {
  return createProvider({
    id: "test-provider",
    auth: { apiKey: { name: "Test", resolve: () => runTest(awaited({ auth: {} })) } },
    models: [model("static")],
    api: {
      stream: () => {
        throw new Error("not used");
      },
      streamSimple: () => {
        throw new Error("not used");
      },
    },
  });
}

function testProvider(localGeneratedAt?: number) {
  return withRemoteCatalog(builtinProvider(), "https://pi.dev", localGeneratedAt);
}

function refreshProvider(
  provider: Provider,
  store: InMemoryModelsStore,
  overrides: Partial<Pick<RefreshModelsContext, "allowNetwork" | "force" | "signal">> = {},
): Promise<void> {
  return runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const publish = (publication: ModelsPublication): Promise<boolean> =>
        effectRunPromise(
          Effect.gen(function* () {
            if (publication.persist === null) yield* awaited(store.delete(provider.id));
            else if (publication.persist !== undefined)
              yield* awaited(store.write(provider.id, publication.persist));
            publication.update?.();
            return yield* awaited(true);
          }),
        );
      yield* awaited(
        provider.refreshModels?.({
          credential: { type: "api_key" as const },
          stored: yield* awaited(store.read(provider.id)),
          publish,
          allowNetwork: overrides.allowNetwork ?? true,
          force: overrides.force,
          signal: overrides.signal ?? neverAbortedSignal,
        }),
      );
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("remote catalog provider", () => {
  it("parses keyed catalogs, sends version headers, observes the refresh TTL, and supports forced refreshes", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
          effectRunPromise(
            awaited(
              new Response(JSON.stringify({ dynamic: model("dynamic") }), {
                status: 200,
                headers: { "content-type": "application/json" },
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
    ));

  it("overlays image and classifier models and drops unknown model types", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        vi.spyOn(globalThis, "fetch").mockImplementation(() =>
          effectRunPromise(
            awaited(
              new Response(
                JSON.stringify({
                  chat: { ...model("chat"), type: "chat" as const },
                  flux: {
                    type: "image" as const,
                    id: "flux",
                    name: "FLUX",
                    api: "openrouter-images" as const,
                    provider: "test-provider",
                    baseUrl: "https://example.test/v1",
                    input: ["text"],
                    output: ["image"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  },
                  jev: {
                    type: "classifier" as const,
                    id: "jev",
                    name: "Jev",
                    api: "typesafe-system-one" as const,
                    provider: "test-provider",
                    baseUrl: "https://example.test/v1",
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 64000,
                  },
                  clip: { ...model("clip"), type: "video" as const },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            ),
          ),
        );
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
        expect(models.getModelOfType("classifier", "test-provider", "jev")?.type).toBe(
          "classifier",
        );
        expect(models.getModel("test-provider", "flux")).toBeUndefined();
        const stored = yield* awaited(store.read(provider.id));
        expect(stored?.models.map((entry) => entry.id)).toEqual(["chat", "flux", "jev"]);
      }),
    ));

  it("prefers the newer of the generated and remote catalogs", () =>
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
    ));

  it("revalidates a stored catalog with its etag and keeps the overlay on 304", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const responses = [
          new Response(yield* toJsonText({ dynamic: model("dynamic") }), {
            headers: { "content-type": "application/json", etag: '"catalog-1"' },
          }),
          new Response(null, { status: 304, headers: { etag: '"catalog-1"' } }),
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
    ));

  it("drops a stale etag when the overlay becomes unavailable", () =>
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
    ));

  it("keeps the etag and overlay after a transient failure", () =>
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
          new Response(null, { status: 304, headers: { etag: '"catalog-1"' } }),
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
    ));

  it("lets a newer catalog request bypass a stalled older request without stale publication", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let calls = 0;
        let markFirstStarted: (() => void) | undefined;
        let finishFirst: ((response: Response) => void) | undefined;
        const firstStarted = new Promise<void>((resolve) => {
          markFirstStarted = resolve;
        });
        const firstResponse = new Promise<Response>((resolve) => {
          finishFirst = resolve;
        });
        vi.spyOn(globalThis, "fetch").mockImplementation(() =>
          effectRunPromise(
            Effect.gen(function* () {
              calls++;
              if (calls === 1) {
                markFirstStarted?.();
                return yield* awaited(firstResponse);
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

        const first = models.refresh({ providers: [provider.id], force: true });
        yield* awaited(firstStarted);
        const second = models.refresh({ providers: [provider.id], force: true });
        yield* awaited(second);
        yield* awaited(first);
        expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "newer"]);

        finishFirst?.(
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
    ));

  it("treats unimplemented pi.dev catalog routes as an unavailable overlay", () =>
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
          models: [],
          checkedAt: expect.any(Number),
        });
      }),
    ));
});

describe("personalized catalog provider", () => {
  const imageModel: ImageModel<"openrouter-images"> = {
    type: "image" as const,
    id: "image",
    name: "image",
    api: "openrouter-images" as const,
    provider: "test-provider",
    baseUrl: "https://example.test/v1",
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  it("keeps the saved list and saves nothing when personalization fails", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));
        const store = new InMemoryModelsStore();
        const saved = { models: [model("allowed")], checkedAt: 1 };
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
    ));

  it("restores a saved list as is, and falls back to the built-in models only when it is empty", () =>
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

        yield* awaited(store.write(provider.id, { models: [], checkedAt: 1 }));
        yield* awaited(refreshProvider(provider, store, { allowNetwork: false }));
        expect(provider.getModels().map((entry) => entry.id)).toEqual(["static"]);

        yield* awaited(store.write(provider.id, { models: [imageModel], checkedAt: 1 }));
        yield* awaited(refreshProvider(provider, store, { allowNetwork: false }));
        expect(provider.getModels()).toEqual([]);
        expect(provider.getAllModels?.().map((entry) => entry.id)).toEqual(["image"]);
      }),
    ));
});
