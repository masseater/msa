export type MemoryKind = "fact" | "preference" | "decision" | "note";
export type MemoryScope = "project" | "global";

export const MEMORY_KINDS: readonly MemoryKind[] = ["fact", "preference", "decision", "note"];

export interface MemoryRecord {
  id: string;
  content: string;
  kind: MemoryKind;
  scope: MemoryScope;
  project: string | null;
  createdAt: number;
  updatedAt: number;
  useCount: number;
  lastUsedAt: number | null;
  embedding: Float32Array | null;
  embeddingModel: string | null;
}

export interface MemoryStoreSearchOptions {
  text: string;
  embedding?: Float32Array;
  project?: string;
  limit: number;
  minScore: number;
}

export interface MemoryScore {
  record: MemoryRecord;
  score: number;
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
  created: boolean;
}

export interface MemoryStoreStats {
  total: number;
  embedded: number;
  projects: number;
  byKind: Record<string, number>;
}

export const RRF_K = 60;
