declare namespace storeTypesTypes {
  type MemoryKind = "fact" | "preference" | "decision" | "note";

  type MemoryScope = "project" | "global";

  interface MemoryRecord {
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

  interface MemoryStoreSearchOptions {
    text: string;
    embedding?: Float32Array;
    project?: string;
    limit: number;
    minScore: number;
  }

  interface MemoryScore {
    record: MemoryRecord;
    score: number;
    keyword: number;
    vector: number | undefined;
  }

  interface MemorySaveInput {
    content: string;
    kind: MemoryKind;
    scope: MemoryScope;
    project: string | null;
    embedding?: Float32Array;
    embeddingModel?: string;
    now?: number;
  }

  interface MemorySaveResult {
    record: MemoryRecord;
    created: boolean;
  }

  interface MemoryStoreStats {
    total: number;
    embedded: number;
    projects: number;
    byKind: Record<string, number>;
  }
}

export type { storeTypesTypes as default };
