import { DatabaseSync } from "node:sqlite";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { MemoryStore } from "../src/core/memory/store.ts";
import memorySupport from "./memory-support.ts";

const { joinPath, runTest } = testing;

const { cleanup, makeWorkspace, vector } = memorySupport;

afterEach(() => runTest(cleanup));

const withStore = (use: (store: MemoryStore) => void): void => {
  const store = new MemoryStore(":memory:");
  try {
    use(store);
  } finally {
    store.close();
  }
};

const saveTwice = (store: MemoryStore, input: Parameters<MemoryStore["save"]>[0]) => {
  const first = store.save(input);
  const again = store.save(input);
  expect(first.created).toBe(true);
  expect(again.created).toBe(false);
  expect(again.record.id).toBe(first.record.id);
  return first;
};

const savesDeduplicatesSearchesAndForgets = () =>
  withStore((store) => {
    const first = saveTwice(store, {
      content: "msa の記憶は SQLite に保存する",
      kind: "fact",
      project: "msa",
      scope: "project",
    });
    const globalFirst = saveTwice(store, {
      content: "global preference",
      kind: "preference",
      project: null,
      scope: "global",
    });

    const hits = store.search({ limit: 5, minScore: 0.2, project: "msa", text: "記憶の保存先" });
    expect(hits.map((hit) => hit.record.id)).toContain(first.record.id);

    const misses = store.search({
      limit: 5,
      minScore: 0.5,
      project: "msa",
      text: "全く関係のない問い合わせ",
    });
    expect(misses).toEqual([]);

    expect(store.forget(first.record.id)).toBe(true);
    expect(store.forget(first.record.id)).toBe(false);
    expect(store.stats().total).toBe(1);
    expect(store.forget(globalFirst.record.id)).toBe(true);
    expect(store.stats().total).toBe(0);
  });

const keepsProjectMemoriesSeparateAndGlobalMemories = () =>
  withStore((store) => {
    store.save({
      content: "project a only",
      kind: "fact",
      now: 1,
      project: "a",
      scope: "project",
    });
    store.save({
      content: "project b only",
      kind: "fact",
      now: 2,
      project: "b",
      scope: "project",
    });
    store.save({
      content: "everywhere",
      kind: "preference",
      now: 3,
      project: null,
      scope: "global",
    });
    expect(store.list({ limit: 10, project: "a" }).map((record) => record.content)).toEqual([
      "everywhere",
      "project a only",
    ]);
    expect(store.list({ limit: 10 }).map((record) => record.content)).toEqual(["everywhere"]);
  });

const ranksByEmbeddingSimilarityWhenVectorsAre = () =>
  withStore((store) => {
    const close = store.save({
      content: "alpha",
      embedding: vector([1, 0]),
      kind: "fact",
      project: "p",
      scope: "project",
    });
    const far = store.save({
      content: "beta",
      embedding: vector([0, 1]),
      kind: "fact",
      project: "p",
      scope: "project",
    });
    const hits = store.search({
      embedding: vector([0.9, 0.1]),
      limit: 5,
      minScore: 0.1,
      project: "p",
      text: "no keywords here",
    });
    expect(hits.map((hit) => hit.record.id)).toEqual([close.record.id, far.record.id]);
    expect(hits[0]!.vector).toBeGreaterThan(hits[1]!.vector!);
  });

const matchesJapaneseBySharedWordsAndGates = () =>
  withStore((store) => {
    const embedding = store.save({
      content: "埋め込みはローカルの bge-m3 で計算する",
      kind: "fact",
      project: "p",
      scope: "project",
    });
    store.save({
      content: "リリース手順は Homebrew に配信する",
      kind: "fact",
      project: "p",
      scope: "project",
    });
    const hits = store.search({
      limit: 5,
      minScore: 0.5,
      project: "p",
      text: "埋め込みの計算方法",
    });
    expect(hits.map((hit) => hit.record.id)).toEqual([embedding.record.id]);
    expect(hits[0]!.keyword).toBeGreaterThanOrEqual(0.5);
    expect(hits[0]!.vector).toBeUndefined();
  });

const ranksAMemoryBothRetrieversReturnAbove = () =>
  withStore((store) => {
    const vectorOnly = store.save({
      content: "alpha",
      embedding: vector([1, 0]),
      kind: "fact",
      project: "p",
      scope: "project",
    });
    const both = store.save({
      content: "homebrew tap",
      embedding: vector([0.8, 0.6]),
      kind: "fact",
      project: "p",
      scope: "project",
    });
    const hits = store.search({
      embedding: vector([1, 0]),
      limit: 5,
      minScore: 0.5,
      project: "p",
      text: "homebrew",
    });
    expect(hits.map((hit) => hit.record.id)).toEqual([both.record.id, vectorOnly.record.id]);
    expect(hits[0]!.score).toBeCloseTo(1 / 62 + 1 / 61);
  });

const indexesMemoriesSavedBeforeTheFullText = () =>
  runTest(
    Effect.gen(function* () {
      const database = joinPath(yield* makeWorkspace(), "memory.db");
      new MemoryStore(database).close();
      const legacy = new DatabaseSync(database);
      legacy.exec("DROP TABLE memories_fts");
      legacy.exec(
        `INSERT INTO memories (id, content, kind, scope, project, created_at, updated_at)
       VALUES ('mem_old', 'legacy memory about homebrew', 'fact', 'global', NULL, 1, 1)`,
      );
      legacy.close();
      const store = new MemoryStore(database);
      try {
        const hits = store.search({ limit: 5, minScore: 0.5, text: "homebrew" });
        expect(hits.map((hit) => hit.record.id)).toEqual(["mem_old"]);
      } finally {
        store.close();
      }
    }),
  );

const countsRecallsOfAMemoryInIts = () =>
  withStore((store) => {
    const used = store.save({
      content: "recall boost target",
      kind: "fact",
      now: 1,
      project: "p",
      scope: "project",
    });
    store.save({
      content: "recall boost target",
      kind: "fact",
      now: 1,
      project: "q",
      scope: "project",
    });
    store.markUsed([used.record.id], 1);
    store.markUsed([used.record.id], 1);
    const [hit] = store.search({ limit: 1, minScore: 0, project: "p", text: "recall boost" });
    expect(hit!.record.id).toBe(used.record.id);
    expect(hit!.record.useCount).toBe(2);
  });

describe("MemoryStore", () => {
  it("saves, deduplicates, searches, and forgets", savesDeduplicatesSearchesAndForgets);

  it(
    "keeps project memories separate and global memories shared",
    keepsProjectMemoriesSeparateAndGlobalMemories,
  );

  it(
    "ranks by embedding similarity when vectors are present",
    ranksByEmbeddingSimilarityWhenVectorsAre,
  );

  it(
    "matches Japanese by shared words and gates on the share of query words",
    matchesJapaneseBySharedWordsAndGates,
  );

  it(
    "ranks a memory both retrievers return above one only the vector retriever returns",
    ranksAMemoryBothRetrieversReturnAbove,
  );

  it(
    "indexes memories saved before the full-text index existed",
    indexesMemoriesSavedBeforeTheFullText,
  );

  it("counts recalls of a memory in its own scope", countsRecallsOfAMemoryInIts);
});
