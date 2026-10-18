import { DatabaseSync, type StatementSync } from "node:sqlite";

import { currentTimeMillis, randomHex } from "../platform/index.ts";
import { type MemoryRow, toRecord } from "./store-row.ts";
import {
  type MemoryRecord,
  type MemorySaveInput,
  type MemorySaveResult,
  type MemoryScore,
  type MemoryStoreSearchOptions,
  type MemoryStoreStats,
} from "./store-types.ts";
import {
  cosineSimilarity,
  encodeVector,
  phrase,
  reciprocalRankFusion,
  segmentWords,
} from "./store-vectors.ts";

export {
  MEMORY_KINDS,
  type MemoryKind,
  type MemoryRecord,
  type MemorySaveInput,
  type MemorySaveResult,
  type MemoryScope,
  type MemoryScore,
  type MemoryStoreSearchOptions,
  type MemoryStoreStats,
  RRF_K,
} from "./store-types.ts";
export { cosineSimilarity, reciprocalRankFusion, segmentWords } from "./store-vectors.ts";

export class MemoryStore {
  readonly databasePath: string;
  private readonly database: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private closed = false;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.database = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        project TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        embedding BLOB,
        embedding_model TEXT
      );
      CREATE INDEX IF NOT EXISTS memories_scope_project ON memories(scope, project);
      CREATE INDEX IF NOT EXISTS memories_updated_at ON memories(updated_at);
    `);
    this.transaction(() => {
      const indexed = this.database
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memories_fts'`)
        .get();
      if (indexed !== undefined) return;
      this.database.exec(`CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, terms)`);
      const rows = this.database.prepare(`SELECT id, content FROM memories`).all() as unknown as {
        id: string;
        content: string;
      }[];
      for (const row of rows) this.index(row.id, row.content);
    });
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = this.database.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  private transaction<T>(body: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private index(id: string, content: string): void {
    this.statement(`INSERT INTO memories_fts (id, terms) VALUES (?, ?)`).run(
      id,
      segmentWords(content).join(" "),
    );
  }

  private scoped(project: string | undefined): MemoryRow[] {
    return this.statement(
      `SELECT * FROM memories WHERE scope = 'global' OR (scope = 'project' AND project = ?)`,
    ).all(project ?? null) as unknown as MemoryRow[];
  }

  private matching(query: string): string[] {
    return (
      this.statement(
        `SELECT id FROM memories_fts WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts)`,
      ).all(query) as unknown as { id: string }[]
    ).map((row) => row.id);
  }

  save(input: MemorySaveInput): MemorySaveResult {
    const now = input.now ?? currentTimeMillis();
    const content = input.content.trim();
    const project = input.scope === "project" ? input.project : null;
    const existing = this.statement(
      `SELECT * FROM memories WHERE content = ? AND scope = ? AND project IS ?`,
    ).get(content, input.scope, project) as unknown as MemoryRow | undefined;
    const embedding = input.embedding === undefined ? null : encodeVector(input.embedding);
    if (existing !== undefined) {
      this.statement(
        `UPDATE memories SET updated_at = ?, embedding = COALESCE(?, embedding),
           embedding_model = COALESCE(?, embedding_model) WHERE id = ?`,
      ).run(now, embedding, input.embeddingModel ?? null, existing.id);
      const refreshed = this.statement(`SELECT * FROM memories WHERE id = ?`).get(
        existing.id,
      ) as unknown as MemoryRow;
      return { record: toRecord(refreshed), created: false };
    }
    const id = `mem_${now.toString(36)}_${randomHex(4)}`;
    this.transaction(() => {
      this.statement(
        `INSERT INTO memories
           (id, content, kind, scope, project, created_at, updated_at, use_count, last_used_at,
            embedding, embedding_model)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
      ).run(
        id,
        content,
        input.kind,
        input.scope,
        project,
        now,
        now,
        embedding,
        input.embeddingModel ?? null,
      );
      this.index(id, content);
    });
    const row = this.statement(`SELECT * FROM memories WHERE id = ?`).get(
      id,
    ) as unknown as MemoryRow;
    return { record: toRecord(row), created: true };
  }

  search(options: MemoryStoreSearchOptions): MemoryScore[] {
    const records = new Map<string, MemoryRecord>();
    for (const row of this.scoped(options.project)) records.set(row.id, toRecord(row));

    const vectors = new Map<string, number>();
    if (options.embedding !== undefined) {
      for (const record of records.values()) {
        if (record.embedding === null) continue;
        const similarity = cosineSimilarity(options.embedding, record.embedding);
        if (similarity >= options.minScore) vectors.set(record.id, similarity);
      }
    }
    const vectorRanking = [...vectors.keys()].sort(
      (left, right) => vectors.get(right)! - vectors.get(left)!,
    );

    const words = [...new Set(segmentWords(options.text))];
    const keywords = new Map<string, number>();
    for (const word of words) {
      for (const id of this.matching(phrase(word))) {
        if (records.has(id)) keywords.set(id, (keywords.get(id) ?? 0) + 1 / words.length);
      }
    }
    const keywordRanking =
      words.length === 0
        ? []
        : this.matching(words.map(phrase).join(" OR ")).filter(
            (id) => (keywords.get(id) ?? 0) >= options.minScore,
          );

    const fused = reciprocalRankFusion([vectorRanking, keywordRanking]);
    const scores: MemoryScore[] = [...fused].map(([id, score]) => ({
      record: records.get(id)!,
      score,
      keyword: keywords.get(id) ?? 0,
      vector: vectors.get(id),
    }));
    scores.sort(
      (left, right) =>
        right.score - left.score ||
        right.record.useCount - left.record.useCount ||
        right.record.updatedAt - left.record.updatedAt,
    );
    return scores.slice(0, options.limit);
  }

  list(options: { project?: string; limit: number }): MemoryRecord[] {
    return this.scoped(options.project)
      .sort((left, right) => right.updated_at - left.updated_at)
      .slice(0, options.limit)
      .map(toRecord);
  }

  get(id: string): MemoryRecord | undefined {
    const row = this.statement(`SELECT * FROM memories WHERE id = ?`).get(id) as unknown as
      | MemoryRow
      | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  listStale(embeddingModel: string, limit: number): MemoryRecord[] {
    return (
      this.statement(
        `SELECT * FROM memories WHERE embedding IS NULL OR embedding_model IS NOT ? ORDER BY updated_at DESC LIMIT ?`,
      ).all(embeddingModel, limit) as unknown as MemoryRow[]
    ).map(toRecord);
  }

  setEmbedding(id: string, embedding: Float32Array, embeddingModel: string): void {
    this.statement(`UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?`).run(
      encodeVector(embedding),
      embeddingModel,
      id,
    );
  }

  forget(id: string): boolean {
    const row = this.statement(`SELECT id FROM memories WHERE id = ?`).get(id) as unknown as
      | { id: string }
      | undefined;
    if (row === undefined) return false;
    this.transaction(() => {
      this.statement(`DELETE FROM memories WHERE id = ?`).run(id);
      this.statement(`DELETE FROM memories_fts WHERE id = ?`).run(id);
    });
    return true;
  }

  markUsed(ids: readonly string[], now = currentTimeMillis()): void {
    const statement = this.statement(
      `UPDATE memories SET use_count = use_count + 1, last_used_at = ? WHERE id = ?`,
    );
    for (const id of ids) statement.run(now, id);
  }

  stats(): MemoryStoreStats {
    const total = (
      this.statement(`SELECT COUNT(*) AS count FROM memories`).get() as {
        count: number;
      }
    ).count;
    const embedded = (
      this.statement(
        `SELECT COUNT(*) AS count FROM memories WHERE embedding IS NOT NULL`,
      ).get() as {
        count: number;
      }
    ).count;
    const projects = (
      this.statement(
        `SELECT COUNT(DISTINCT project) AS count FROM memories WHERE project IS NOT NULL`,
      ).get() as { count: number }
    ).count;
    const byKind: Record<string, number> = {};
    for (const row of this.statement(
      `SELECT kind, COUNT(*) AS count FROM memories GROUP BY kind`,
    ).all() as unknown as Array<{ kind: string; count: number }>) {
      byKind[row.kind] = row.count;
    }
    return { total, embedded, projects, byKind };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.statements.clear();
    this.database.close();
  }
}
