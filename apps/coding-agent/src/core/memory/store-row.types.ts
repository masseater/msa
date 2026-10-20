declare namespace storeRowTypes {
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
}

export type { storeRowTypes as default };
