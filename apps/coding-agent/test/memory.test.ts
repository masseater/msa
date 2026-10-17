import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  keywordScore,
  MemoryStore,
  queryTerms,
} from "../src/core/memory/store.ts";
import { createMemoryToolDefinition } from "../src/core/tools/memory.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";

const tempDirs: string[] = [];
const servers: Server[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "msa-memory-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function vector(values: number[]): Float32Array {
  return new Float32Array(values);
}

async function embeddingServer(
  responses: number[][],
): Promise<{ baseUrl: string; inputs: string[] }> {
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, inputs };
}

function settings(overrides: Partial<ResolvedMemorySettings> = {}): ResolvedMemorySettings {
  return {
    enabled: true,
    database: join(tempDir(), "memory.db"),
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

describe("queryTerms and keywordScore", () => {
  it("splits words and adds CJK bigrams", () => {
    expect(queryTerms("pnpm over npm")).toEqual(["pnpm", "over", "npm"]);
    expect(queryTerms("埋め込みの計算方法")).toEqual(
      expect.arrayContaining(["埋め込みの計算方法", "埋め", "計算", "方法"]),
    );
  });

  it("scores partial Japanese matches above unrelated text", () => {
    expect(
      keywordScore("埋め込みはローカルの bge-m3 で計算する", "埋め込みの計算方法"),
    ).toBeGreaterThan(0.3);
    expect(keywordScore("リリース手順は Homebrew に配信する", "埋め込みの計算方法")).toBe(0);
    expect(keywordScore("The release goes to the Homebrew tap", "homebrew tap")).toBe(1);
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
        kind: "fact",
        scope: "project",
        project: "msa",
      });
      expect(first.created).toBe(true);
      const again = store.save({
        content: "msa の記憶は SQLite に保存する",
        kind: "fact",
        scope: "project",
        project: "msa",
      });
      expect(again.created).toBe(false);
      expect(again.record.id).toBe(first.record.id);
      const globalFirst = store.save({
        content: "global preference",
        kind: "preference",
        scope: "global",
        project: null,
      });
      const globalAgain = store.save({
        content: "global preference",
        kind: "preference",
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
        kind: "fact",
        scope: "project",
        project: "a",
        now: 1,
      });
      store.save({
        content: "project b only",
        kind: "fact",
        scope: "project",
        project: "b",
        now: 2,
      });
      store.save({
        content: "everywhere",
        kind: "preference",
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
        kind: "fact",
        scope: "project",
        project: "p",
        embedding: vector([1, 0]),
      });
      const far = store.save({
        content: "beta",
        kind: "fact",
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

  it("boosts memories that were recalled before", () => {
    const store = new MemoryStore(":memory:");
    try {
      const used = store.save({
        content: "recall boost target",
        kind: "fact",
        scope: "project",
        project: "p",
        now: 1,
      });
      store.save({
        content: "recall boost target",
        kind: "fact",
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
    expect(parseMemoryCommand("/memory")).toEqual({ kind: "status" });
    expect(parseMemoryCommand("/memory list")).toEqual({ kind: "list" });
    expect(parseMemoryCommand("/memory stats")).toEqual({ kind: "stats" });
    expect(parseMemoryCommand("/memory search release process")).toEqual({
      kind: "search",
      query: "release process",
    });
    expect(parseMemoryCommand("/memory forget mem_1")).toEqual({ kind: "forget", id: "mem_1" });
    expect(parseMemoryCommand("/memory what did we decide")).toEqual({
      kind: "search",
      query: "what did we decide",
    });
    expect(parseMemoryCommand("/memories")).toBeUndefined();
  });
});

describe("EmbeddingClient", () => {
  it("normalizes vectors and rejects dimension changes", async () => {
    const { baseUrl } = await embeddingServer([
      [3, 4],
      [1, 0, 0],
    ]);
    const client = new EmbeddingClient({ baseUrl, model: "test", timeoutMs: 2_000 });
    const first = await client.embed("hello");
    expect(first[0]).toBeCloseTo(0.6);
    expect(first[1]).toBeCloseTo(0.8);
    expect(client.dimensions).toBe(2);
    await expect(client.embed("hello")).rejects.toThrow("changed dimension");
  });
});

describe("MemoryService", () => {
  it("saves with an embedding and recalls by meaning", async () => {
    const { baseUrl, inputs } = await embeddingServer([[1, 0]]);
    const service = new MemoryService({
      settings: settings({ embedding: embeddingSettings(baseUrl) }),
      cwd: tempDir(),
    });
    try {
      const saved = await service.save({ content: "リリースは Homebrew tap に配信する" });
      expect(saved.created).toBe(true);
      expect(saved.embedded).toBe(true);
      const recalled = await service.recall("パッケージの配布方法は？");
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
  });

  it("re-embeds memories that were saved without a vector", async () => {
    const dir = tempDir();
    const database = join(dir, "memory.db");
    const first = new MemoryService({ settings: settings({ database }), cwd: dir });
    const saved = await first.save({ content: "reembed this memory" });
    expect(saved.embedded).toBe(false);
    first.close();

    const { baseUrl, inputs } = await embeddingServer([[1, 0]]);
    const second = new MemoryService({
      settings: settings({ database, embedding: embeddingSettings(baseUrl) }),
      cwd: dir,
    });
    try {
      expect(await second.reembedStale()).toBe(1);
      expect(second.stats().embedded).toBe(1);
      expect(inputs).toEqual(["D: reembed this memory"]);
      expect(await second.reembedStale()).toBe(0);
    } finally {
      second.close();
    }
  });

  it("saves keyword-only memories when the endpoint is unreachable", async () => {
    const service = new MemoryService({ settings: settings(), cwd: tempDir() });
    try {
      const saved = await service.save({ content: "failover keeps keywords searchable" });
      expect(saved.embedded).toBe(false);
      const hits = await service.search("keywords");
      expect(hits.map((hit) => hit.record.id)).toContain(saved.record.id);
    } finally {
      service.close();
    }
  });

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
  it("saves, searches, lists, and forgets through the tool", async () => {
    const service = new MemoryService({ settings: settings(), cwd: tempDir() });
    const tool = wrapToolDefinition(createMemoryToolDefinition(service));
    try {
      const saved = await tool.execute("call-1", {
        action: "save",
        content: "prefer pnpm over npm",
        kind: "preference",
      });
      expect(saved.content[0]).toMatchObject({ type: "text" });
      const savedText = saved.content[0]?.type === "text" ? saved.content[0].text : "";
      expect(savedText).toContain("Saved memory");

      const search = await tool.execute("call-2", { action: "search", query: "pnpm preference" });
      expect(search.content[0]?.type === "text" ? search.content[0].text : "").toContain("pnpm");

      const list = await tool.execute("call-3", { action: "list" });
      expect(list.content[0]?.type === "text" ? list.content[0].text : "").toContain("prefer pnpm");

      const details = saved.details;
      const id = details && typeof details["id"] === "string" ? details["id"] : "";
      const forget = await tool.execute("call-4", { action: "forget", id });
      expect(forget.content[0]?.type === "text" ? forget.content[0].text : "").toContain(
        `Forgot memory ${id}`,
      );
      await expect(tool.execute("call-5", { action: "search", query: "x" })).resolves.toBeDefined();
      await expect(tool.execute("call-6", { action: "save" })).rejects.toThrow("content");
    } finally {
      service.close();
    }
  });
});

describe("formats", () => {
  it("renders recall, list, and search blocks", () => {
    const store = new MemoryStore(":memory:");
    try {
      const record = store.save({
        content: "msa の記憶は SQLite に保存する",
        kind: "fact",
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
    expect(resolveProjectName(join(repo, "apps"))).toBe(repo.split("/").pop());
    const dir = tempDir();
    expect(resolveProjectName(dir)).toBe(dir.split("/").pop());
  });
});
