import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import EmbeddingClient from "../src/core/memory/embeddings.ts";
import memoryFormat from "../src/core/memory/memory-format.ts";
import memorySupport from "./memory-support.ts";

const { parseMemoryCommand } = memoryFormat;
const { awaited, joinPath, runTest } = testing;

const { cleanup, embeddingServer, embeddingSettings, makeWorkspace, openService, settings } =
  memorySupport;

afterEach(() => runTest(cleanup));

const readsStatusListStatsSearchAndForget = () => {
  expect(parseMemoryCommand("/memory")).toEqual({ kind: "status" });
  expect(parseMemoryCommand("/memory list")).toEqual({ kind: "list" });
  expect(parseMemoryCommand("/memory stats")).toEqual({ kind: "stats" });
  expect(parseMemoryCommand("/memory search release process")).toEqual({
    kind: "search",
    query: "release process",
  });
  expect(parseMemoryCommand("/memory forget mem_1")).toEqual({ id: "mem_1", kind: "forget" });
  expect(parseMemoryCommand("/memory what did we decide")).toEqual({
    kind: "search",
    query: "what did we decide",
  });
  expect(parseMemoryCommand("/memories")).toBeUndefined();
};

describe("parseMemoryCommand", () => {
  it("reads status, list, stats, search, and forget", readsStatusListStatsSearchAndForget);
});

const normalizesVectorsAndRejectsDimensionChanges = () =>
  runTest(
    Effect.gen(function* () {
      const { baseUrl } = yield* embeddingServer([
        [3, 4],
        [1, 0, 0],
      ]);
      const client = new EmbeddingClient({ baseUrl, model: "test", timeoutMs: 2_000 });
      const first = yield* awaited(client.embed("hello"));
      expect(first[0]).toBeCloseTo(0.6);
      expect(first[1]).toBeCloseTo(0.8);
      expect(client.dimensions).toBe(2);
      yield* awaited(expect(client.embed("hello")).rejects.toThrow("changed dimension"));
    }),
  );

describe("EmbeddingClient", () => {
  it(
    "normalizes vectors and rejects dimension changes",
    normalizesVectorsAndRejectsDimensionChanges,
  );
});

const savesWithAnEmbeddingAndRecallsBy = () =>
  runTest(
    Effect.scoped(
      Effect.gen(function* () {
        const { baseUrl, inputs } = yield* embeddingServer([[1, 0]]);
        const workspace = yield* makeWorkspace();
        const service = yield* openService(
          workspace,
          settings(workspace, { embedding: embeddingSettings(baseUrl) }),
        );
        const saved = yield* awaited(
          service.save({ content: "リリースは Homebrew tap に配信する" }),
        );
        expect(saved.created).toBe(true);
        expect(saved.embedded).toBe(true);
        const recalled = yield* awaited(service.recall("パッケージの配布方法は？"));
        expect(recalled.map((record) => record.id)).toContain(saved.record.id);
        expect(service.list()).toHaveLength(1);
        expect(service.forget(saved.record.id)).toBe(true);
        expect(service.describeStatus()).toContain("Memory is enabled.");
        expect(inputs).toEqual([
          "D: リリースは Homebrew tap に配信する",
          "Q: パッケージの配布方法は？",
        ]);
      }),
    ),
  );

const leavesTheEmbeddingEndpointAloneUntilA = () =>
  runTest(
    Effect.scoped(
      Effect.gen(function* () {
        const { baseUrl, inputs } = yield* embeddingServer([[1, 0]]);
        const workspace = yield* makeWorkspace();
        const service = yield* openService(
          workspace,
          settings(workspace, { embedding: embeddingSettings(baseUrl) }),
        );
        expect(yield* awaited(service.recall("how do we ship releases?"))).toEqual([]);
        expect(yield* awaited(service.search("releases"))).toEqual([]);
        expect(inputs).toEqual([]);

        yield* awaited(service.save({ content: "releases ship through the Homebrew tap" }));
        yield* awaited(service.recall("how do we ship releases?"));
        expect(inputs).toEqual([
          "D: releases ship through the Homebrew tap",
          "Q: how do we ship releases?",
        ]);
      }),
    ),
  );

const saveWithoutEmbedding = Effect.fn("saveWithoutEmbedding")(function* (
  workspace: string,
  database: string,
) {
  const service = yield* openService(workspace, settings(workspace, { database }));
  const saved = yield* awaited(service.save({ content: "reembed this memory" }));
  expect(saved.embedded).toBe(false);
});

const reEmbedsMemoriesThatWereSavedWithout = () =>
  runTest(
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace();
      const database = joinPath(workspace, "memory.db");
      yield* Effect.scoped(saveWithoutEmbedding(workspace, database));

      const { baseUrl, inputs } = yield* embeddingServer([[1, 0]]);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* openService(
            workspace,
            settings(workspace, { database, embedding: embeddingSettings(baseUrl) }),
          );
          expect(yield* awaited(service.reembedStale())).toBe(1);
          expect(service.stats().embedded).toBe(1);
          expect(inputs).toEqual(["D: reembed this memory"]);
          expect(yield* awaited(service.reembedStale())).toBe(0);
        }),
      );
    }),
  );

const savesKeywordOnlyMemoriesWhenTheEndpoint = () =>
  runTest(
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* makeWorkspace();
        const service = yield* openService(workspace, settings(workspace));
        const saved = yield* awaited(
          service.save({ content: "failover keeps keywords searchable" }),
        );
        expect(saved.embedded).toBe(false);
        const hits = yield* awaited(service.search("keywords"));
        expect(hits.map((hit) => hit.record.id)).toContain(saved.record.id);
      }),
    ),
  );

const reportsDisabledMemoryWithoutAStore = () =>
  runTest(
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* makeWorkspace();
        const service = yield* openService(workspace, settings(workspace, { enabled: false }));
        expect(service.describeStatus()).toContain("disabled");
      }),
    ),
  );

describe("MemoryService", () => {
  it("saves with an embedding and recalls by meaning", savesWithAnEmbeddingAndRecallsBy);

  it(
    "leaves the embedding endpoint alone until a memory exists",
    leavesTheEmbeddingEndpointAloneUntilA,
  );

  it("re-embeds memories that were saved without a vector", reEmbedsMemoriesThatWereSavedWithout);

  it(
    "saves keyword-only memories when the endpoint is unreachable",
    savesKeywordOnlyMemoriesWhenTheEndpoint,
  );

  it("reports disabled memory without a store", reportsDisabledMemoryWithoutAStore);
});
