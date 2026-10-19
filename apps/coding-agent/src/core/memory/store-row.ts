import type { MemoryKind, MemoryRecord, MemoryScope } from "./store-types.ts";
import { decodeVector } from "./store-vectors.ts";

export interface MemoryRow {
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

export function toRecord(row: MemoryRow): MemoryRecord {
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
    embedding: row.embedding === null ? null : decodeVector(row.embedding),
    embeddingModel: row.embedding_model,
  };
}
