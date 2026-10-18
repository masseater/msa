import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { awaited, runTest, removePath, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { EmbeddingClient } from "../src/core/memory/embeddings.ts";
import {
  formatMemoryList,
  formatRecallBlock,
  formatSearchResults,
  MemoryService,
  parseMemoryCommand,
  resolveProjectName,
  type ResolvedMemorySettings,
} from "../src/core/memory/memory.ts";
import {
  cosineSimilarity,
  MemoryStore,
  reciprocalRankFusion,
  segmentWords,
} from "../src/core/memory/store.ts";
import { createMemoryToolDefinition } from "../src/core/tools/memory.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";

const tempDirs: string[] = [];
const servers: Server[] = [];

function tempDir(): string {
  const dir = mkdtempSync(joinPath(tmpdir(), "msa-memory-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      for (const server of servers.splice(0)) {
        yield* awaited(new Promise<void>((resolve) => server.close(() => resolve())));
      }
      for (const dir of tempDirs.splice(0)) yield* removePath(dir);
    }),
  ),
);

function vector(values: number[]): Float32Array {
  return new Float32Array(values);
}

function embeddingServer(responses: number[][]): Promise<{ baseUrl: string; inputs: string[] }> {
  return runTest(
    Effect.gen(function* () {
      let index = 0;
      const inputs: string[] = [];
      const server = createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => (body += String(chunk)));
        request.on("end", () => {
          try {
            inputs.push(String(JSON.parse(body).input));
          } catch {
            inputs.push("");
          }
          const values = responses[Math.min(index, responses.length - 1)];
          index++;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ data: [{ embedding: values }] }));
        });
      });
      servers.push(server);
      yield* awaited(
        new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve())),
      );
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      return yield* awaited({ baseUrl: `http://127.0.0.1:${address.port}/v1`, inputs });
    }),
  );
}

function settings(overrides: Partial<ResolvedMemorySettings> = {}): ResolvedMemorySettings {
  return {
    enabled: true,
    database: joinPath(tempDir(), "memory.db"),
    embedding: {
      enabled: false,
      baseUrl: "http://127.0.0.1:1/v1",
      model: "test",
      queryPrefix: "",
      documentPrefix: "",
      timeoutMs: 500,
    },
    recall: { enabled: true, limit: 5, minScore: 0.35 },
    ...overrides,
  };
}

function embeddingSettings(baseUrl: string): ResolvedMemorySettings["embedding"] {
  return {
    enabled: true,
    baseUrl,
    model: "test",
    queryPrefix: "Q: ",
    documentPrefix: "D: ",
    timeoutMs: 2_000,
  };
}

describe("segmentWords", () => {
  it("splits English and Japanese into lowercased words without punctuation", () => {
    expect(segmentWords("Prefer pnpm over npm.")).toEqual(["prefer", "pnpm", "over", "npm"]);
    expect(segmentWords("記憶の保存先は？")).toEqual(expect.arrayContaining(["記憶", "保存"]));
  });
});

describe("reciprocalRankFusion", () => {
  it("adds 1 / (60 + rank) from every ranking", () => {
    const fused = reciprocalRankFusion([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(fused.get("a")).toBeCloseTo(1 / 61);
    expect(fused.get("b")).toBeCloseTo(1 / 62 + 1 / 61);
    expect(fused.get("c")).toBeCloseTo(1 / 62);
  });
});

describe("cosineSimilarity", () => {
  it("scores identical, orthogonal, and mismatched vectors", () => {
    expect(cosineSimilarity(vector([1, 0]), vector([1, 0]))).toBeCloseTo(1);
    expect(cosineSimilarity(vector([1, 0]), vector([0, 1]))).toBeCloseTo(0);
    expect(cosineSimilarity(vector([1, 0]), vector([1, 0, 0]))).toBe(0);
  });
});

describe("MemoryStore", () => {
  it("saves, deduplicates, searches, and forgets", () => {
    const store = new MemoryStore(":memory:");
    try {
      const first = store.save({
        content: "msa の記憶は SQLite に保存する",
        kind: "fact" as const,
        scope: "project",
        project: "msa",
      });
      expect(first.created).toBe(true);
      const again = store.save({
        content: "msa の記憶は SQLite に保存する",
        kind: "fact" as const,
        scope: "project",
        project: "msa",
      });
      expect(again.created).toBe(false);
      expect(again.record.id).toBe(first.record.id);
      const globalFirst = store.save({
        content: "global preference",
        kind: "preference" as const,
        scope: "global",
        project: null,
      });
      const globalAgain = store.save({
        content: "global preference",
        kind: "preference" as const,
        scope: "global",
        project: null,
      });
      expect(globalFirst.created).toBe(true);
      expect(globalAgain.created).toBe(false);

      const hits = store.search({
        text: "記憶の保存先",
        project: "msa",
        limit: 5,
        minScore: 0.2,
      });
      expect(hits.map((hit) => hit.record.id)).toContain(first.record.id);

      const misses = store.search({
        text: "全く関係のない問い合わせ",
        project: "msa",
        limit: 5,
        minScore: 0.5,
      });
      expect(misses).toEqual([]);

      expect(store.forget(first.record.id)).toBe(true);
      expect(store.forget(first.record.id)).toBe(false);
      expect(store.stats().total).toBe(1);
      expect(store.forget(globalFirst.record.id)).toBe(true);
      expect(store.stats().total).toBe(0);
    } finally {
      store.close();
    }
  });

  it("keeps project memories separate and global memories shared", () => {
    const store = new MemoryStore(":memory:");
    try {
      store.save({
        content: "project a only",
        kind: "fact" as const,
        scope: "project",
        project: "a",
        now: 1,
      });
      store.save({
        content: "project b only",
        kind: "fact" as const,
        scope: "project",
        project: "b",
        now: 2,
      });
      store.save({
        content: "everywhere",
        kind: "preference" as const,
        scope: "global",
        project: null,
        now: 3,
      });
      expect(store.list({ project: "a", limit: 10 }).map((record) => record.content)).toEqual([
        "everywhere",
        "project a only",
      ]);
      expect(store.list({ limit: 10 }).map((record) => record.content)).toEqual(["everywhere"]);
    } finally {
      store.close();
    }
  });

  it("ranks by embedding similarity when vectors are present", () => {
    const store = new MemoryStore(":memory:");
    try {
      const close = store.save({
        content: "alpha",
        kind: "fact" as const,
        scope: "project",
        project: "p",
        embedding: vector([1, 0]),
      });
      const far = store.save({
        content: "beta",
        kind: "fact" as const,
        scope: "project",
        project: "p",
        embedding: vector([0, 1]),
      });
      const hits = store.search({
        text: "no keywords here",
        embedding: vector([0.9, 0.1]),
        project: "p",
        limit: 5,
        minScore: 0.1,
      });
      expect(hits.map((hit) => hit.record.id)).toEqual([close.record.id, far.record.id]);
      expect(hits[0]!.vector).toBeGreaterThan(hits[1]!.vector!);
    } finally {
      store.close();
    }
  });

  it("matches Japanese by shared words and gates on the share of query words", () => {
    const store = new MemoryStore(":memory:");
    try {
      const embedding = store.save({
        content: "埋め込みはローカルの bge-m3 で計算する",
        kind: "fact" as const,
        scope: "project",
        project: "p",
      });
      store.save({
        content: "リリース手順は Homebrew に配信する",
        kind: "fact" as const,
        scope: "project",
        project: "p",
      });
      const hits = store.search({
        text: "埋め込みの計算方法",
        project: "p",
        limit: 5,
        minScore: 0.5,
      });
      expect(hits.map((hit) => hit.record.id)).toEqual([embedding.record.id]);
      expect(hits[0]!.keyword).toBeGreaterThanOrEqual(0.5);
      expect(hits[0]!.vector).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("ranks a memory both retrievers return above one only the vector retriever returns", () => {
    const store = new MemoryStore(":memory:");
    try {
      const vectorOnly = store.save({
        content: "alpha",
        kind: "fact" as const,
        scope: "project",
        project: "p",
        embedding: vector([1, 0]),
      });
      const both = store.save({
        content: "homebrew tap",
        kind: "fact" as const,
        scope: "project",
        project: "p",
        embedding: vector([0.8, 0.6]),
      });
      const hits = store.search({
        text: "homebrew",
        embedding: vector([1, 0]),
        project: "p",
        limit: 5,
        minScore: 0.5,
      });
      expect(hits.map((hit) => hit.record.id)).toEqual([both.record.id, vectorOnly.record.id]);
      expect(hits[0]!.score).toBeCloseTo(1 / 62 + 1 / 61);
    } finally {
      store.close();
    }
  });

  it("indexes memories saved before the full-text index existed", () => {
    const database = joinPath(tempDir(), "memory.db");
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
      const hits = store.search({ text: "homebrew", limit: 5, minScore: 0.5 });
      expect(hits.map((hit) => hit.record.id)).toEqual(["mem_old"]);
    } finally {
      store.close();
    }
  });

  it("counts recalls of a memory in its own scope", () => {
    const store = new MemoryStore(":memory:");
    try {
      const used = store.save({
        content: "recall boost target",
        kind: "fact" as const,
        scope: "project",
        project: "p",
        now: 1,
      });
      store.save({
        content: "recall boost target",
        kind: "fact" as const,
        scope: "project",
        project: "q",
        now: 1,
      });
      store.markUsed([used.record.id], 1);
      store.markUsed([used.record.id], 1);
      const [hit] = store.search({ text: "recall boost", project: "p", limit: 1, minScore: 0 });
      expect(hit!.record.id).toBe(used.record.id);
      expect(hit!.record.useCount).toBe(2);
    } finally {
      store.close();
    }
  });
});

describe("parseMemoryCommand", () => {
  it("reads status, list, stats, search, and forget", () => {
    expect(parseMemoryCommand("/memory")).toEqual({ kind: "status" as const });
    expect(parseMemoryCommand("/memory list")).toEqual({ kind: "list" as const });
    expect(parseMemoryCommand("/memory stats")).toEqual({ kind: "stats" as const });
    expect(parseMemoryCommand("/memory search release process")).toEqual({
      kind: "search" as const,
      query: "release process",
    });
    expect(parseMemoryCommand("/memory forget mem_1")).toEqual({
      kind: "forget" as const,
      id: "mem_1",
    });
    expect(parseMemoryCommand("/memory what did we decide")).toEqual({
      kind: "search" as const,
      query: "what did we decide",
    });
    expect(parseMemoryCommand("/memories")).toBeUndefined();
  });
});

describe("EmbeddingClient", () => {
  it("normalizes vectors and rejects dimension changes", () =>
    runTest(
      Effect.gen(function* () {
        const { baseUrl } = yield* awaited(
          embeddingServer([
            [3, 4],
            [1, 0, 0],
          ]),
        );
        const client = new EmbeddingClient({ baseUrl, model: "test", timeoutMs: 2_000 });
        const first = yield* awaited(client.embed("hello"));
        expect(first[0]).toBeCloseTo(0.6);
        expect(first[1]).toBeCloseTo(0.8);
        expect(client.dimensions).toBe(2);
        yield* awaited(expect(client.embed("hello")).rejects.toThrow("changed dimension"));
      }),
    ));
});

describe("MemoryService", () => {
  it("saves with an embedding and recalls by meaning", () =>
    runTest(
      Effect.gen(function* () {
        const { baseUrl, inputs } = yield* awaited(embeddingServer([[1, 0]]));
        const service = new MemoryService({
          settings: settings({ embedding: embeddingSettings(baseUrl) }),
          cwd: tempDir(),
        });
        try {
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
        } finally {
          service.close();
        }
      }),
    ));

  it("re-embeds memories that were saved without a vector", () =>
    runTest(
      Effect.gen(function* () {
        const dir = tempDir();
        const database = joinPath(dir, "memory.db");
        const first = new MemoryService({ settings: settings({ database }), cwd: dir });
        const saved = yield* awaited(first.save({ content: "reembed this memory" }));
        expect(saved.embedded).toBe(false);
        first.close();

        const { baseUrl, inputs } = yield* awaited(embeddingServer([[1, 0]]));
        const second = new MemoryService({
          settings: settings({ database, embedding: embeddingSettings(baseUrl) }),
          cwd: dir,
        });
        try {
          expect(yield* awaited(second.reembedStale())).toBe(1);
          expect(second.stats().embedded).toBe(1);
          expect(inputs).toEqual(["D: reembed this memory"]);
          expect(yield* awaited(second.reembedStale())).toBe(0);
        } finally {
          second.close();
        }
      }),
    ));

  it("saves keyword-only memories when the endpoint is unreachable", () =>
    runTest(
      Effect.gen(function* () {
        const service = new MemoryService({ settings: settings(), cwd: tempDir() });
        try {
          const saved = yield* awaited(
            service.save({ content: "failover keeps keywords searchable" }),
          );
          expect(saved.embedded).toBe(false);
          const hits = yield* awaited(service.search("keywords"));
          expect(hits.map((hit) => hit.record.id)).toContain(saved.record.id);
        } finally {
          service.close();
        }
      }),
    ));

  it("reports disabled memory without a store", () => {
    const service = new MemoryService({
      settings: settings({ enabled: false }),
      cwd: tempDir(),
    });
    expect(service.describeStatus()).toContain("disabled");
    service.close();
  });
});

describe("memory tool", () => {
  it("saves, searches, lists, and forgets through the tool", () =>
    runTest(
      Effect.gen(function* () {
        const service = new MemoryService({ settings: settings(), cwd: tempDir() });
        const tool = wrapToolDefinition(createMemoryToolDefinition(service));
        try {
          const saved = yield* awaited(
            tool.execute("call-1", {
              action: "save",
              content: "prefer pnpm over npm",
              kind: "preference" as const,
            }),
          );
          expect(saved.content[0]).toMatchObject({ type: "text" as const });
          const savedText = saved.content[0]?.type === "text" ? saved.content[0].text : "";
          expect(savedText).toContain("Saved memory");

          const search = yield* awaited(
            tool.execute("call-2", { action: "search", query: "pnpm preference" }),
          );
          expect(search.content[0]?.type === "text" ? search.content[0].text : "").toContain(
            "pnpm",
          );

          const list = yield* awaited(tool.execute("call-3", { action: "list" }));
          expect(list.content[0]?.type === "text" ? list.content[0].text : "").toContain(
            "prefer pnpm",
          );

          const details = saved.details;
          const id =
            details !== undefined && typeof details["id"] === "string" ? details["id"] : "";
          const forget = yield* awaited(tool.execute("call-4", { action: "forget", id }));
          expect(forget.content[0]?.type === "text" ? forget.content[0].text : "").toContain(
            `Forgot memory ${id}`,
          );
          yield* awaited(
            expect(tool.execute("call-5", { action: "search", query: "x" })).resolves.toBeDefined(),
          );
          yield* awaited(
            expect(tool.execute("call-6", { action: "save" })).rejects.toThrow("content"),
          );
        } finally {
          service.close();
        }
      }),
    ));
});

describe("formats", () => {
  it("renders recall, list, and search blocks", () => {
    const store = new MemoryStore(":memory:");
    try {
      const record = store.save({
        content: "msa の記憶は SQLite に保存する",
        kind: "fact" as const,
        scope: "project",
        project: "msa",
      }).record;
      const block = formatRecallBlock([record]);
      expect(block).toContain("<memory>");
      expect(block).toContain("msa の記憶は SQLite に保存する");
      expect(formatMemoryList([record])).toContain(record.id);
      const hits = store.search({ text: "記憶", project: "msa", limit: 5, minScore: 0 });
      expect(formatSearchResults(hits)).toContain(record.id);
      expect(formatMemoryList([])).toBe("No memories stored yet.");
    } finally {
      store.close();
    }
  });
});

describe("resolveProjectName", () => {
  it("uses the git repository name when available", () => {
    const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    expect(resolveProjectName(joinPath(repo, "apps"))).toBe(repo.split("/").pop());
    const dir = tempDir();
    expect(resolveProjectName(dir)).toBe(dir.split("/").pop());
  });
});
