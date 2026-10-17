/**
 * SQLite-backed storage for long-term memories.
 *
 * One database file holds every memory. Search is hybrid: a cosine score over stored embeddings
 * plus a keyword score that treats CJK text as character bigrams so Japanese matches without a
 * tokenizer, with small boosts for recent and frequently recalled records. Ranking runs over the
 * rows of the selected scopes in memory, which keeps the store dependency-free and identical under
 * Node and Bun.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export type MemoryKind = "fact" | "preference" | "decision" | "note";
export type MemoryScope = "project" | "global";

export const MEMORY_KINDS: readonly MemoryKind[] = ["fact", "preference", "decision", "note"];

export interface MemoryRecord {
  id: string;
  content: string;
  kind: MemoryKind;
  scope: MemoryScope;
  /** Project name when `scope` is `project`, otherwise null. */
  project: string | null;
  createdAt: number;
  updatedAt: number;
  useCount: number;
  lastUsedAt: number | null;
  embedding: Float32Array | null;
  embeddingModel: string | null;
}

export interface MemoryStoreSearchOptions {
  /** Query text for the keyword score. */
  text: string;
  /** Query embedding for the cosine score, when an embedding provider answered. */
  embedding?: Float32Array;
  /** Project scope to search next to global memories. */
  project?: string;
  limit: number;
  minScore: number;
}

export interface MemoryScore {
  record: MemoryRecord;
  /** Ranking score: relevance plus the recency and use boosts. */
  score: number;
  /** Relevance alone: the better of the vector and keyword signals, 0 when neither matched. */
  relevance: number;
  keyword: number;
  vector: number | undefined;
}

export interface MemorySaveInput {
  content: string;
  kind: MemoryKind;
  scope: MemoryScope;
  project: string | null;
  embedding?: Float32Array;
  embeddingModel?: string;
  now?: number;
}

export interface MemorySaveResult {
  record: MemoryRecord;
  /** False when an identical memory in the same scope was refreshed instead. */
  created: boolean;
}

export interface MemoryStoreStats {
  total: number;
  embedded: number;
  projects: number;
  byKind: Record<string, number>;
}

const RECENCY_BOOST = 0.08;
const USE_BOOST = 0.05;
const RECENCY_HALF_LIFE_DAYS = 180;
const MAX_USE_BOOST_COUNT = 5;
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const WORD_SPLIT = /[^\p{L}\p{N}_]+/u;

/**
 * Query terms for the keyword score: whitespace- and punctuation-separated words, plus every
 * character bigram of a CJK run, so a query like `埋め込みの計算方法` matches text that shares only
 * part of it.
 */
export function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const word of query.toLowerCase().split(WORD_SPLIT)) {
    if (!word) continue;
    terms.add(word);
    if (word.length > 2 && CJK.test(word)) {
      for (let index = 0; index + 2 <= word.length; index++) {
        terms.add(word.slice(index, index + 2));
      }
    }
  }
  return [...terms];
}

/** Share of the query terms that occur in `content`, between 0 and 1. */
export function keywordScore(content: string, query: string): number {
  const haystack = content.toLowerCase();
  const terms = queryTerms(query);
  if (terms.length === 0) return 0;
  let hits = 0;
  for (const term of terms) {
    if (haystack.includes(term)) hits++;
  }
  return hits / terms.length;
}

/** Cosine similarity, 0 when either vector is empty or the lengths differ. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    const left = a[index]!;
    const right = b[index]!;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function recencyScore(updatedAt: number, now: number): number {
  const ageDays = Math.max(0, now - updatedAt) / 86_400_000;
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Score of one record. Relevance is the better of the vector and keyword signals, so a keyword hit
 * cannot dilute a strong vector match (or the other way around); recency and use only order the
 * relevant ones. The recall gate applies to relevance, not to the boosts.
 */
export function scoreMemory(
  record: MemoryRecord,
  query: { text: string; embedding?: Float32Array },
  now: number,
): MemoryScore {
  const keyword = keywordScore(record.content, query.text);
  const vector =
    query.embedding && record.embedding ? cosineSimilarity(query.embedding, record.embedding) : 0;
  const hasVector = vector > 0;
  const relevance = Math.max(hasVector ? vector : 0, keyword);
  const useBoost =
    (USE_BOOST * Math.min(record.useCount, MAX_USE_BOOST_COUNT)) / MAX_USE_BOOST_COUNT;
  const boost = RECENCY_BOOST * recencyScore(record.updatedAt, now) + useBoost;
  return {
    record,
    keyword,
    vector: hasVector ? vector : undefined,
    relevance,
    score: relevance + boost,
  };
}

function encodeVector(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(0), vector.byteOffset, vector.byteLength);
}

function decodeVector(bytes: Uint8Array): Float32Array {
  // node:sqlite returns a view that may not be 4-byte aligned; copy before reading floats.
  const copy = bytes.slice();
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

interface MemoryRow {
  id: string;
  content: string;
  kind: string;
  scope: string;
  project: string | null;
  created_at: number;
  updated_at: number;
  use_count: number;
  last_used_at: number | null;
  embedding: Uint8Array | null;
  embedding_model: string | null;
}

function toRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    content: row.content,
    kind: row.kind as MemoryKind,
    scope: row.scope as MemoryScope,
    project: row.project,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at,
    embedding: row.embedding ? decodeVector(row.embedding) : null,
    embeddingModel: row.embedding_model,
  };
}

/** Long-term memory rows in one SQLite file. */
export class MemoryStore {
  readonly databasePath: string;
  private readonly database: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private closed = false;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
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
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.database.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  /** Rows of the scopes a search may see: global memories and those of `project`. */
  private scoped(project: string | undefined): MemoryRow[] {
    return this.statement(
      `SELECT * FROM memories WHERE scope = 'global' OR (scope = 'project' AND project = ?)`,
    ).all(project ?? null) as unknown as MemoryRow[];
  }

  /**
   * Save a memory. An identical content in the same scope refreshes the existing row instead of
   * creating a duplicate, and the refreshed row keeps its creation time and use count.
   */
  save(input: MemorySaveInput): MemorySaveResult {
    const now = input.now ?? Date.now();
    const content = input.content.trim();
    const project = input.scope === "project" ? input.project : null;
    const existing = this.statement(
      `SELECT * FROM memories WHERE content = ? AND scope = ? AND project IS ?`,
    ).get(content, input.scope, project) as unknown as MemoryRow | undefined;
    const embedding = input.embedding ? encodeVector(input.embedding) : null;
    if (existing) {
      this.statement(
        `UPDATE memories SET updated_at = ?, embedding = COALESCE(?, embedding),
           embedding_model = COALESCE(?, embedding_model) WHERE id = ?`,
      ).run(now, embedding, input.embeddingModel ?? null, existing.id);
      const refreshed = this.statement(`SELECT * FROM memories WHERE id = ?`).get(
        existing.id,
      ) as unknown as MemoryRow;
      return { record: toRecord(refreshed), created: false };
    }
    const id = `mem_${now.toString(36)}_${randomBytes(4).toString("hex")}`;
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
    const row = this.statement(`SELECT * FROM memories WHERE id = ?`).get(
      id,
    ) as unknown as MemoryRow;
    return { record: toRecord(row), created: true };
  }

  /** Ranked memories above `minScore`, best first. */
  search(options: MemoryStoreSearchOptions): MemoryScore[] {
    const now = Date.now();
    const scores: MemoryScore[] = [];
    for (const row of this.scoped(options.project)) {
      const scored = scoreMemory(toRecord(row), options, now);
      if (scored.relevance >= options.minScore) scores.push(scored);
    }
    scores.sort((left, right) => right.score - left.score);
    return scores.slice(0, options.limit);
  }

  /** Newest first, optionally limited to one scope. */
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
    return row ? toRecord(row) : undefined;
  }

  /** Memories without a vector or with one from another model, newest first. */
  listStale(embeddingModel: string, limit: number): MemoryRecord[] {
    return (
      this.statement(
        `SELECT * FROM memories WHERE embedding IS NULL OR embedding_model IS NOT ? ORDER BY updated_at DESC LIMIT ?`,
      ).all(embeddingModel, limit) as unknown as MemoryRow[]
    ).map(toRecord);
  }

  /** Replace the stored vector of a memory, for example after the embedding model changed. */
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
    if (!row) return false;
    this.statement(`DELETE FROM memories WHERE id = ?`).run(id);
    return true;
  }

  /** Bump the use counters of recalled memories, so frequently useful ones rank higher later. */
  markUsed(ids: readonly string[], now = Date.now()): void {
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
